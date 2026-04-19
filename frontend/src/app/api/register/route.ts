import { NextResponse } from "next/server";
import { VertexAI } from "@google-cloud/vertexai";
import admin from "firebase-admin";

// 1. Initialize Firebase (Auto-uses GOOGLE_APPLICATION_CREDENTIALS)
if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.error('Firebase initialization error:', error);
  }
}

const db = admin.firestore();

// 2. Initialize Vertex AI (Auto-uses GOOGLE_APPLICATION_CREDENTIALS)
const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID as string,
  location: 'us-central1' 
});

const generativeModel = vertexAI.getGenerativeModel({
  model: 'gemini-2.5-flash', // Vertex AI Pro model
  generationConfig: {
    responseMimeType: "application/json",
  }
});

// Helper: Split text to avoid passing massive walls of text to the AI at once
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

// Helper: Delay to prevent hitting Vertex AI rate limits
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Core Logic: The Semantic Shadow Extractor
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

  const request = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  };

  const result = await generativeModel.generateContent(request);
  const responseText = result.response.candidates[0].content.parts[0].text;
  
  // Clean potential markdown formatting
  const cleanJson = responseText.replace(/```json|```/g, "").trim();
  return JSON.parse(cleanJson);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { title, text, userId } = body;

    if (!title || !text || !userId) {
      return NextResponse.json({ error: "title, text and userId required" }, { status: 400 });
    }

    const chunks = chunkText(text);
    const docRef = db.collection("documents").doc();

    const chunkData = [];

    // Process chunks and extract shadows
    for (const [i, chunk] of chunks.entries()) {
      const shadow = await extractShadow(chunk);
      
      chunkData.push({
        chunkIndex: i,
        shadow, // We ONLY store the shadow, not the raw text (Privacy First)
      });

      // 4-second pause between chunks to respect API limits
      if (i < chunks.length - 1) {
        await delay(4000); 
      }
    }

    // Save to Firestore
    await docRef.set({
      userId,
      title,
      chunks: chunkData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ 
      success: true, 
      docId: docRef.id, 
      chunksProcessed: chunkData.length 
    });

  } catch (err) {
    console.error("Extraction error:", err);
    return NextResponse.json({ error: "Shadow extraction failed" }, { status: 500 });
  }
}