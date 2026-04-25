import { NextResponse } from "next/server";
import { VertexAI } from "@google-cloud/vertexai";
import admin from "firebase-admin";
import { GoogleAuth } from "google-auth-library";

// 1. Parse the JSON string directly from the .env file
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON as string);

// 2. Initialize Firebase manually using the parsed credentials
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

// 4. Manually authenticate the Vector API request
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

// Generate the 768-dimensional vector
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

// Extract Semantic Shadow
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
  const clean = responseText.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

const PLAGIARISM_THRESHOLD = 80;

// --- MAIN POST HANDLER ---
export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

    const chunks = chunkText(text);
    const results = [];

    for (const [i, chunk] of chunks.entries()) {
      const shadow = await extractShadow(chunk);
      const embedding = await getEmbedding(shadow);

      console.log(`\n--- [Chunk ${i}] STARTING VECTOR SEARCH ---`);
      console.log(`Vector dimension generated: ${embedding.length} (Should be 768)`);

      // 1. Vector Search against the "chunks" Subcollection
      const querySnapshot = await db.collectionGroup("chunks")
        .findNearest({
          vectorField: "embedding",
          queryVector: admin.firestore.FieldValue.vector(embedding),
          distanceMeasure: "COSINE",
          limit: 1,
          distanceResultField: "computedDistance" 
        })
        .get();

      console.log(`Documents found by Firestore: ${querySnapshot.size}`);

      let highestMatch = { score: 0, docId: "none", title: "No Match", flagged: false };

      if (querySnapshot.empty) {
        console.log(`❌ ERROR: Firestore returned 0 matches. Is the Vector Index built?`);
      } else {
        const topDoc = querySnapshot.docs[0];
        const topData = topDoc.data();
        
        console.log(`✅ MATCH FOUND! Document path: ${topDoc.ref.path}`);
        console.log(`Raw computed distance from DB:`, topData.computedDistance);

        // 2. Proper Math Normalization
        const distance: number = topData.computedDistance; 
        
        if (distance === undefined) {
          console.log(`⚠️ WARNING: Distance is undefined! Math will fail.`);
        }

        const score = (1 - (distance / 2)) * 100;
        console.log(`Calculated Score: ${score}%`);

        const parentDoc = await topDoc.ref.parent.parent?.get();
        
        highestMatch = {
          score: parseFloat(score.toFixed(1)),
          docId: parentDoc?.id || "unknown",
          title: parentDoc?.data()?.title || "Untitled Document",
          flagged: score >= PLAGIARISM_THRESHOLD,
        };
      }

      results.push({
        chunkIndex: i,
        shadow,
        highestMatch
      });

      if (i < chunks.length - 1) await delay(4000); 
    }

    const isPlagiarised = results.some(r => r.highestMatch.flagged);

    return NextResponse.json({
      success: true,
      overallVerdict: isPlagiarised ? "PLAGIARISM DETECTED" : "ORIGINAL",
      results,
    });

  } catch (err) {
    console.error("\n💥 VERIFICATION CRASH:", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}