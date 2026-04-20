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
  generationConfig: {
    responseMimeType: "application/json",
  }
});


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

async function getEmbedding(shadow: any): Promise<number[]> {
  const text = shadowToText(shadow);
  const accessToken = await getAccessToken();
  
  const response = await fetch(
    `https://us-central1-aiplatform.googleapis.com/v1/projects/${process.env.GCP_PROJECT_ID}/locations/us-central1/publishers/google/models/text-multilingual-embedding-002:predict`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ 
          content: text,
          task_type: "RETRIEVAL_DOCUMENT" 
        }],
      }),
    }
  );
  
  const data = await response.json();
  if (!data.predictions?.[0]) throw new Error("Embedding API failed: " + JSON.stringify(data));
  
  // Extract values from the new response format
  return data.predictions[0].embeddings.values;
}

async function getAccessToken(): Promise<string> {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    scopes: "https://www.googleapis.com/auth/cloud-platform",
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token!;
}

async function extractShadow(chunk: string) {
  const prompt = `You are 'Aura', an advanced forensic linguistics engine. 
  Extract the Semantic Shadow of the provided text.
  Translate all extracted concepts into English regardless of input language.
  
  Return ONLY valid JSON:
  {
    "core_thesis": "single sentence summarizing the main argument",
    "primary_arguments": ["argument 1", "argument 2"],
    "unique_entities": ["specific names, technologies, locations mentioned"],
    "structural_flow": "how the text transitions",
    "tone": "emotional or professional tone"
  }
  
  Text: ${chunk}`;

  const request = {
    contents: [{ role: 'user' as const, parts: [{ text: prompt }] }]
  };

  const result = await generativeModel.generateContent(request);
  const responseText = result.response.candidates![0].content.parts[0].text!;
  const clean = responseText.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

export async function POST(req: Request) {
  try {
    const { title, text, userId, isOG } = await req.json();

    const chunks = chunkText(text);
    const docRef = db.collection("documents").doc();

    // 1. Save Parent Document
    await docRef.set({
      userId,
      title,
      isOriginal: isOG || false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 2. Process and Save Chunks
    for (const [i, chunk] of chunks.entries()) {
      const shadow = await extractShadow(chunk);
      const embedding = await getEmbedding(shadow);

      // Store in sub-collection to avoid 1MB limit
      await docRef.collection("chunks").add({
        chunkIndex: i,
        shadow,
        text: chunk, // Storing raw text helps highlight matches later
        // Use Firestore's native Vector type
        embedding: admin.firestore.FieldValue.vector(embedding),
      });

      if (i < chunks.length - 1) await delay(2000); 
    }

    return NextResponse.json({ success: true, docId: docRef.id });
  } catch (err) {
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}