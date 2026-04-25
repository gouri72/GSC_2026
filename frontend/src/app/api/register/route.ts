import { NextResponse } from "next/server";
import { VertexAI } from "@google-cloud/vertexai";
import admin from "firebase-admin";
import { GoogleAuth } from "google-auth-library";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import * as crypto from "crypto";

// ─── Service Account ──────────────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON as string);

// ─── Firebase Init ────────────────────────────────────────────────────────────
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (error) {
    console.error("Firebase initialization error:", error);
  }
}

const db = admin.firestore();

// ─── Vertex AI Init ───────────────────────────────────────────────────────────
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

const generativeModel = vertexAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: { responseMimeType: "application/json" },
});

// ─── KMS Init ─────────────────────────────────────────────────────────────────
const kmsClient = new KeyManagementServiceClient({
  projectId: process.env.GCP_PROJECT_ID as string,
  credentials: {
    client_email: serviceAccount.client_email,
    private_key: serviceAccount.private_key,
  },
});

// ─── Token Cache (avoids re-fetching access token on every request) ───────────
let cachedToken: { token: string; expiry: number } | null = null;

// ─── Auth Verification ────────────────────────────────────────────────────────
// Reads the Firebase ID token from the Authorization header and verifies it
// cryptographically using Firebase Admin. This is the ONLY source of userId.
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

// ─── Access Token (cached) ────────────────────────────────────────────────────
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
    expiry: now + 55 * 60 * 1000, // cache for 55 minutes
  };

  return cachedToken.token;
}

// ─── Shadow Extraction ────────────────────────────────────────────────────────
// Sends each text chunk to Gemini and extracts the structured Semantic Shadow.
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
// Converts the Semantic Shadow into a 768-dimensional vector using
// Google's multilingual embedding model.
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

  // Sanity check — model should always return 768 dimensions
  console.log(`[Embedding] Dimensions: ${embedding.length}`);
  if (embedding.length !== 768) {
    throw new Error(`Unexpected embedding dimensions: ${embedding.length}. Expected 768.`);
  }

  return embedding;
}

// ─── KMS Signature Engine ─────────────────────────────────────────────────────
// Signs the document fingerprint using Google Cloud KMS (RSA-2048).
// The resulting signature is the cryptographic Ownership Certificate.
// It can be verified publicly but cannot be forged or backdated.
async function generateOwnershipSignature(documentData: string): Promise<string> {
  const versionName = kmsClient.cryptoKeyVersionPath(
    process.env.GCP_PROJECT_ID as string,
    "us-central1",       // must match where you created the keyring
    "aura-vault-ring",   // your keyring name
    "ownership-signature-key", // your key name
    "1"                  // key version
  );

  // SHA-256 hash of the fingerprint payload
  const digest = crypto.createHash("sha256").update(documentData).digest();

  const [signResponse] = await kmsClient.asymmetricSign({
    name: versionName,
    digest: { sha256: digest },
  });

  return Buffer.from(signResponse.signature as Uint8Array).toString("base64");
}

// ─── Main POST Handler ────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {

    // ── Step 1: Verify Firebase Auth Token ───────────────────────────────────
    // This MUST happen first. If the token is missing or invalid,
    // we return 401 immediately without processing anything.
    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyAuthToken(req);
    } catch (authError: any) {
      console.error("[Auth] Token verification failed:", authError.message);
      return NextResponse.json({ error: authError.message }, { status: 401 });
    }

    // Extract identity from the verified token.
    // NEVER trust userId from the request body — always use the token.
    const userId = decodedToken.uid;
    const userEmail = decodedToken.email ?? "unknown";
    console.log(`[Auth] Verified user: ${userEmail} (uid: ${userId})`);

    // ── Step 2: Parse and Validate Request Body ───────────────────────────────
    const body = await req.json();
    const { title, text } = body; // userId intentionally NOT read from body

    if (!title || !text) {
      return NextResponse.json(
        { error: "title and text are required" },
        { status: 400 }
      );
    }

    if (text.trim().split(" ").length < 20) {
      return NextResponse.json(
        { error: "Text is too short to register. Provide at least 20 words." },
        { status: 400 }
      );
    }

    // ── Step 3: Chunk the Text ────────────────────────────────────────────────
    const chunks = chunkText(text);
    console.log(`[Register] Processing ${chunks.length} chunk(s) for "${title}"`);

    // ── Step 4: Create the Document Reference Early ───────────────────────────
    // We need the docId before writing so it can be included in the fingerprint.
    const parentDocRef = db.collection("documents").doc();

    // ── Step 5: Build Document Fingerprint ───────────────────────────────────
    // This is what gets signed by KMS. It binds the document identity,
    // the verified owner, and a timestamp together into one payload.
    const documentFingerprint = JSON.stringify({
      documentId: parentDocRef.id,
      userId,      // from verified Firebase token
      userEmail,   // from verified Firebase token
      title,
      timestamp: Date.now(),
    });

    // ── Step 6: Generate KMS Ownership Certificate ────────────────────────────
    console.log("[KMS] Generating ownership signature...");
    const digitalSignature = await generateOwnershipSignature(documentFingerprint);
    console.log("[KMS] Ownership certificate generated successfully.");

    // ── Step 7: Save Parent Document to Firestore ─────────────────────────────
    await parentDocRef.set({
      userId,          // verified owner
      userEmail,       // verified email
      title,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      totalChunks: chunks.length,
      kmsSignature: digitalSignature,   // cryptographic proof of ownership
      fingerprint: documentFingerprint, // what was signed (for verification)
    });

    console.log(`[Firestore] Parent document saved: ${parentDocRef.id}`);

    // ── Step 8: Extract Shadows + Embeddings → Store Chunks ──────────────────
    // Processed sequentially with a delay to avoid rate limiting on Gemini API.
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
        embedding: admin.firestore.FieldValue.vector(embeddingArray), // stored as Vector<768>
      });

      console.log(`[Chunk ${i + 1}/${chunks.length}] Stored successfully.`);
      chunksProcessed++;

      // Delay between chunks to avoid Gemini rate limits
      if (i < chunks.length - 1) await delay(4000);
    }

    // ── Step 9: Return Success Response ──────────────────────────────────────
    return NextResponse.json({
      success: true,
      docId: parentDocRef.id,
      chunksProcessed,
      registeredBy: userEmail,
      // Return partial signature for UI display (first 40 chars)
      certificatePreview: digitalSignature.substring(0, 40) + "...",
    });

  } catch (err: any) {
    console.error("[Register] Unhandled error:", err);
    return NextResponse.json(
      { error: "Vault registration failed", detail: err.message },
      { status: 500 }
    );
  }
}