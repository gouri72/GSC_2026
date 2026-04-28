import { NextResponse } from "next/server";
import { VertexAI } from "@google-cloud/vertexai";
import admin from "firebase-admin";
import { GoogleAuth } from "google-auth-library";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import * as crypto from "crypto";

export const dynamic = 'force-dynamic';

// ─── Build Phase Safeguard ────────────────────────────────────────────────────
const isBuildPhase = process.env.NEXT_PHASE === "true" || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

let serviceAccount: any = {};
let db: any = {};
let generativeModel: any = null;
let kmsClient: any = null;

if (!isBuildPhase) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON as string);

    // ─── Firebase Init ───
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    db = admin.firestore();

    // ─── Vertex AI Init ───
    const vertexAI = new VertexAI({
      project: process.env.GCP_PROJECT_ID as string,
      location: "us-central1",
      googleAuthOptions: {
        credentials: {
          client_email: serviceAccount.client_email,
          private_key: serviceAccount.private_key,
        },
      },
    });

    generativeModel = vertexAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { responseMimeType: "application/json" },
    });

    // ─── KMS Init ───
    kmsClient = new KeyManagementServiceClient({
      projectId: process.env.GCP_PROJECT_ID as string,
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      },
    });

  } catch (error) {
    console.error("Initialization error during live startup:", error);
  }
} else {
  console.warn("Build phase detected: Skipping Register route initialization.");
}

// ─── Token Cache ──────────────────────────────────────────────────────────────
let cachedToken: { token: string; expiry: number } | null = null;

async function verifyAuthToken(req: Request): Promise<admin.auth.DecodedIdToken> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("UNAUTHENTICATED: No Authorization header provided.");
  }
  const idToken = authHeader.split("Bearer ")[1];
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch {
    throw new Error("UNAUTHENTICATED: Invalid or expired token.");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function shadowToText(shadow: any): string {
  return [
    shadow.core_thesis,
    ...(shadow.primary_arguments || []),
    ...(shadow.unique_entities || []),
    shadow.structural_flow,
    shadow.tone,
  ].join(" ");
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiry - now > 5 * 60 * 1000) {
    return cachedToken.token;
  }
  const auth = new GoogleAuth({
    scopes: "https://www.googleapis.com/auth/cloud-platform",
    credentials: {
      client_email: serviceAccount.client_email,
      private_key: serviceAccount.private_key,
    },
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  cachedToken = {
    token: tokenResponse.token!,
    expiry: now + 55 * 60 * 1000, 
  };
  return cachedToken.token;
}

// ─── Shadow Extraction ────────────────────────────────────────────────────────
async function extractShadow(chunk: string): Promise<any> {
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

  const request = {
    contents: [{ role: "user" as const, parts: [{ text: prompt }] }],
  };

  const result = await generativeModel.generateContent(request);
  const responseText = result.response.candidates![0].content.parts[0].text!;
  const cleanJson = responseText.replace(/```json|```/g, "").trim();
  return JSON.parse(cleanJson);
}

// ─── Embedding ────────────────────────────────────────────────────────────────
async function getEmbedding(shadow: any): Promise<number[]> {
  const text = shadowToText(shadow);
  const accessToken = await getAccessToken();

  const response = await fetch(
    `https://us-central1-aiplatform.googleapis.com/v1/projects/${process.env.GCP_PROJECT_ID}/locations/us-central1/publishers/google/models/text-multilingual-embedding-002:predict`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ content: text, task_type: "RETRIEVAL_DOCUMENT" }],
      }),
    }
  );

  const data = await response.json();
  if (!data.predictions?.[0]) {
    throw new Error("Embedding API failed: " + JSON.stringify(data));
  }
  const embedding: number[] = data.predictions[0].embeddings.values;
  if (embedding.length !== 768) {
    throw new Error(`Unexpected embedding dimensions: ${embedding.length}. Expected 768.`);
  }
  return embedding;
}

// ... (keep all imports and initializations above the same)

// ─── KMS Signature Engine ─────────────────────────────────────────────────────
async function generateOwnershipSignature(documentData: string): Promise<string> {
  // Use the direct resource path string to avoid SDK formatting errors
  const versionName = `projects/${process.env.GCP_PROJECT_ID}/locations/us-central1/keyRings/aura-vault-ring/cryptoKeys/ownership-signature-key/cryptoKeyVersions/1`;
  
  const digest = crypto.createHash("sha256").update(documentData).digest();
  
  try {
    const [signResponse] = await kmsClient.asymmetricSign({
      name: versionName,
      digest: { sha256: digest },
    });
    
    if (!signResponse.signature) {
      throw new Error("KMS returned an empty signature.");
    }

    return Buffer.from(signResponse.signature as Uint8Array).toString("base64");
  } catch (error: any) {
    console.error("[KMS Engine Error]:", error.message);
    throw new Error(`KMS Signing Failed: ${error.message}`);
  }
}

// ─── Main POST Handler ────────────────────────────────────────────────────────
export async function POST(req: Request) {
  // Escape hatch for the build phase!
  if (isBuildPhase) {
    return NextResponse.json({ status: "Build Phase OK" });
  }

  try {
    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyAuthToken(req);
    } catch (authError: any) {
      console.error("[Auth] Token verification failed:", authError.message);
      return NextResponse.json({ error: authError.message }, { status: 401 });
    }

    const userId = decodedToken.uid;
    const userEmail = decodedToken.email ?? "unknown";
    console.log(`[Auth] Verified user: ${userEmail} (uid: ${userId})`);

    const body = await req.json();
    const { title, text } = body; 

    if (!title || !text) {
      return NextResponse.json({ error: "title and text are required" }, { status: 400 });
    }
    if (text.trim().split(" ").length < 20) {
      return NextResponse.json({ error: "Text is too short to register. Provide at least 20 words." }, { status: 400 });
    }

    const chunks = chunkText(text);
    console.log(`[Register] Processing ${chunks.length} chunk(s) for "${title}"`);

    const parentDocRef = db.collection("documents").doc();

    const documentFingerprint = JSON.stringify({
      documentId: parentDocRef.id,
      userId,
      userEmail,
      title,
      timestamp: Date.now(),
    });

    console.log("[KMS] Generating ownership signature...");
    // This call now uses the hardcoded path for stability
    const digitalSignature = await generateOwnershipSignature(documentFingerprint);
    console.log("[KMS] Ownership certificate generated successfully.");

    await parentDocRef.set({
      userId,
      userEmail,
      title,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      totalChunks: chunks.length,
      kmsSignature: digitalSignature,
      fingerprint: documentFingerprint,
    });

    console.log(`[Firestore] Parent document saved: ${parentDocRef.id}`);

    let chunksProcessed = 0;
    for (const [i, chunk] of chunks.entries()) {
      console.log(`[Chunk ${i + 1}/${chunks.length}] Extracting shadow...`);
      const shadow = await extractShadow(chunk);

      console.log(`[Chunk ${i + 1}/${chunks.length}] Generating embedding...`);
      const embeddingArray = await getEmbedding(shadow);

      const chunkDocRef = parentDocRef.collection("chunks").doc(`chunk_${i}`);
      await chunkDocRef.set({
        chunkIndex: i,
        shadow,
        embedding: admin.firestore.FieldValue.vector(embeddingArray), 
      });

      console.log(`[Chunk ${i + 1}/${chunks.length}] Stored successfully.`);
      chunksProcessed++;

      // Rate limiting delay for Google APIs
      if (i < chunks.length - 1) await delay(4000);
    }

    return NextResponse.json({
      success: true,
      docId: parentDocRef.id,
      chunksProcessed,
      registeredBy: userEmail,
      ownershipSignature: digitalSignature, // Send full signature for UI
      certificatePreview: digitalSignature.substring(0, 40) + "...",
    });

  } catch (err: any) {
    console.error("[Register] Unhandled error:", err);
    return NextResponse.json(
      { error: "Vault registration failed", details: err.message },
      { status: 500 }
    );
  }
}