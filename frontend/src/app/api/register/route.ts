import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.error('Firebase admin initialization error', error);
  }
}

const db = admin.firestore();

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const gemini = genai.getGenerativeModel({ model: "gemini-2.0-flash" });

// chunk helper
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

// extract semantic shadow from one chunk
async function extractShadow(chunk: string) {
  const prompt = `Extract the semantic meaning of this text. Return ONLY valid JSON with these fields:
  {
    "core_logic": ["main point 1", "main point 2"],
    "unique_arguments": ["unique idea 1"],
    "tone": "academic/creative/technical/etc",
    "domain": "subject area"
  }
  Text: ${chunk}`;

  const result = await gemini.generateContent(prompt);
  const raw = result.response.text();
  
  // strip markdown code fences if Gemini wraps it
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { title, text, userId } = body;

    if (!title || !text || !userId) {
      return NextResponse.json({ error: "title, text and userId required" }, { status: 400 });
    }

    const chunks = chunkText(text);
    const docRef = db.collection("documents").doc(); // auto ID

    const chunkData = [];

    for (const [i, chunk] of chunks.entries()) {
      const shadow = await extractShadow(chunk);
      chunkData.push({
        chunkIndex: i,
        chunkText: chunk,       // store for debugging, remove later for privacy
        shadow,
      });
    }

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
    console.error(err);
    return NextResponse.json({ error: "Shadow extraction failed" }, { status: 500 });
  }
}
