import { NextResponse } from "next/server";
import { VertexAI } from "@google-cloud/vertexai";

// 1. Initialize Vertex AI (No Firebase needed here!)
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

// Helper: Split text to avoid passing massive walls of text at once
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

// Helper: Delay to respect API limits
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
  
  const cleanJson = responseText.replace(/```json|```/g, "").trim();
  return JSON.parse(cleanJson);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text } = body;

    // We only need the text for this route
    if (!text) {
      return NextResponse.json({ error: "text is required for verification" }, { status: 400 });
    }

    const chunks = chunkText(text);
    const chunkData = [];

    // Process chunks and extract shadows
    for (const [i, chunk] of chunks.entries()) {
      const shadow = await extractShadow(chunk);
      
      chunkData.push({
        chunkIndex: i,
        shadow, 
      });

      if (i < chunks.length - 1) {
        await delay(4000); 
      }
    }

    // --- NO DATABASE SAVE ---
    // We instantly return the generated shadow directly back to the frontend
    return NextResponse.json({ 
      success: true, 
      message: "Shadow generated for comparison",
      chunksProcessed: chunkData.length,
      extractedShadows: chunkData 
    });

  } catch (err) {
    console.error("Verification extraction error:", err);
    return NextResponse.json({ error: "Shadow extraction failed" }, { status: 500 });
  }
}