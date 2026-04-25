import { NextResponse } from "next/server";
import { VertexAI } from "@google-cloud/vertexai";
import admin from "firebase-admin";
import { GoogleAuth } from "google-auth-library";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import * as crypto from "crypto";

// 1. Parse the JSON string directly from the .env file
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON as string);

// 2. Initialize Firebase manually
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error('Firebase initialization error:', error);
  }
}

const db = admin.firestore();

// 3. Initialize Vertex AI manually
const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID as string,
  location: 'us-central1',
  googleAuthOptions: {
    credentials: {
      client_email: serviceAccount.client_email,
      private_key: serviceAccount.private_key,
    }
  }
});

const generativeModel = vertexAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: { responseMimeType: "application/json" }
});

// 4. Initialize KMS Client manually
const kmsClient = new KeyManagementServiceClient({
  projectId: process.env.GCP_PROJECT_ID as string,
  credentials: {
    client_email: serviceAccount.client_email,
    private_key: serviceAccount.private_key,
  }
});

// --- HELPER FUNCTIONS ---
function chunkText(text: string, size = 500, overlap = 100): string[] {
  const words = text.split(" ");
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + size).join(" "));
    i += size - overlap;
  }
  return chunks;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function shadowToText(shadow: any): string {
  return [
    shadow.core_thesis,
    ...(shadow.primary_arguments || []),
    ...(shadow.unique_entities || []),
    shadow.structural_flow,
    shadow.tone
  ].join(" ");
}

async function getAccessToken(): Promise<string> {
  const auth = new GoogleAuth({ 
    scopes: "https://www.googleapis.com/auth/cloud-platform",
    credentials: {
      client_email: serviceAccount.client_email,
      private_key: serviceAccount.private_key,
    }
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token!;
}

async function getEmbedding(shadow: any): Promise<number[]> {
  const text = shadowToText(shadow);
  const accessToken = await getAccessToken();
  const response = await fetch(
    `https://us-central1-aiplatform.googleapis.com/v1/projects/${process.env.GCP_PROJECT_ID}/locations/us-central1/publishers/google/models/text-multilingual-embedding-002:predict`,
    {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ content: text, task_type: "RETRIEVAL_DOCUMENT" }],
      }),
    }
  );
  const data = await response.json();
  if (!data.predictions?.[0]) throw new Error("Embedding API failed");
  return data.predictions[0].embeddings.values;
}

async function extractShadow(chunk: string) {
  const prompt = `You are 'Aura', an advanced forensic linguistics engine. 
  Extract the 'Semantic Shadow' of the provided text.
  CRITICAL: Translate all extracted concepts into English, regardless of the input language.
  
  Return ONLY valid JSON matching this schema:
  {
    "core_thesis": "A single sentence summarizing the main argument.",
    "primary_arguments": ["argument 1", "argument 2"],
    "unique_entities": ["specific names", "technologies", "locations mentioned"],
    "structural_flow": "Briefly describe how the text transitions",
    "tone": "The emotional or professional tone of the author"
  }
  
  Text: ${chunk}`;

  const request = { contents: [{ role: 'user' as const, parts: [{ text: prompt }] }] };
  const result = await generativeModel.generateContent(request);
  const responseText = result.response.candidates![0].content.parts[0].text!;
  const cleanJson = responseText.replace(/```json|```/g, "").trim();
  return JSON.parse(cleanJson);
}

// --- KMS SIGNATURE ENGINE ---
async function generateOwnershipSignature(documentData: string): Promise<string> {
  const versionName = kmsClient.cryptoKeyVersionPath(
    process.env.GCP_PROJECT_ID as string,
    'us-central1',
    'aura-vault-ring',
    'ownership-signature-key',
    '1' 
  );

  const hash = crypto.createHash('sha256');
  hash.update(documentData);
  const digest = hash.digest();

  const [signResponse] = await kmsClient.asymmetricSign({
    name: versionName,
    digest: { sha256: digest },
  });

  return signResponse.signature!.toString('base64');
}

// --- MAIN POST HANDLER ---
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { title, text, userId } = body;

    if (!title || !text || !userId) {
      return NextResponse.json({ error: "title, text and userId required" }, { status: 400 });
    }

    const chunks = chunkText(text);
    const parentDocRef = db.collection("documents").doc();
    
    // 1. Create the unique fingerprint
    const documentFingerprint = JSON.stringify({
      documentId: parentDocRef.id,
      userId: userId,
      title: title,
      timestamp: Date.now()
    });

    // 2. Generate the Cryptographic Seal
    console.log("Generating KMS Signature...");
    const digitalSignature = await generateOwnershipSignature(documentFingerprint);
    console.log("KMS Signature generated successfully!");

    // 3. Save Parent Document
    await parentDocRef.set({
      userId,
      title,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      totalChunks: chunks.length,
      kmsSignature: digitalSignature, 
      fingerprint: documentFingerprint 
    });

    let chunksProcessed = 0;

    // 4. Process Chunks
    for (const [i, chunk] of chunks.entries()) {
      const shadow = await extractShadow(chunk);
      const embeddingArray = await getEmbedding(shadow);
      
      const chunkDocRef = parentDocRef.collection("chunks").doc(`chunk_${i}`);
      
      await chunkDocRef.set({
        chunkIndex: i,
        shadow: shadow,
        embedding: admin.firestore.FieldValue.vector(embeddingArray) 
      });

      chunksProcessed++;
      if (i < chunks.length - 1) await delay(4000); 
    }

    return NextResponse.json({ 
      success: true, 
      docId: parentDocRef.id, 
      chunksProcessed: chunksProcessed 
    });

  } catch (err) {
    console.error("Extraction/Signing error:", err);
    return NextResponse.json({ error: "Vault registration failed" }, { status: 500 });
  }
}