import { NextResponse } from "next/server";
import { VertexAI } from "@google-cloud/vertexai";
import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.error('Firebase initialization error:', error);
  }
}

const db = admin.firestore();

const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID as string,
  location: 'us-central1'
});

const generativeModel = vertexAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: { responseMimeType: "application/json" }
});

// --- HELPER FUNCTIONS (Ensure these match your Register route) ---
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
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
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
  Extract the Semantic Shadow of the provided text.
  Translate all extracted concepts into English regardless of input language.
  Return ONLY valid JSON...`; // (Keep your full prompt here)

  const request = { contents: [{ role: 'user' as const, parts: [{ text: prompt + chunk }] }] };
  const result = await generativeModel.generateContent(request);
  const responseText = result.response.candidates![0].content.parts[0].text!;
  const clean = responseText.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

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

      // 1. Search the Collection Group "chunks" using Firestore Vector Search
      // This is the building block that makes it work with your Register route
      const querySnapshot = await db.collectionGroup("chunks")
        .findNearest({
          vectorField: "embedding",
          queryVector: admin.firestore.FieldValue.vector(embedding),
          distanceMeasure: "COSINE",
          limit: 1,
        })
        .get();

      let highestMatch = { score: 0, docId: "none", title: "No Match" };

      if (!querySnapshot.empty) {
        const doc = querySnapshot.docs[0];
        const distance = doc.data().distance; // Distance 0 is identical
        const score = 1 - (distance / 2); // Normalize to 0-1
        
        // Get parent document for the title
        const parentDoc = await doc.ref.parent.parent?.get();
        
        highestMatch = {
          score: Math.round(score * 100),
          docId: parentDoc?.id || "unknown",
          title: parentDoc?.data()?.title || "Untitled Document"
        };
      }

      results.push({
        chunkIndex: i,
        shadow,
        highestMatch: {
          ...highestMatch,
          flagged: highestMatch.score > 90,
        }
      });

      if (i < chunks.length - 1) await delay(2000);
    }

    return NextResponse.json({
      success: true,
      overallVerdict: results.some(r => r.highestMatch.flagged) ? "PLAGIARISM DETECTED" : "ORIGINAL",
      results,
    });

  } catch (err) {
    console.error("Verification error:", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}