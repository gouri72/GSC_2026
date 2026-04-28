import { NextResponse } from "next/server";
import admin, { db } from "@/lib/firebaseAdmin";

export const dynamic = 'force-dynamic';

export async function GET() {
    // Escape hatch for the build phase
    const isBuildPhase = process.env.NEXT_PHASE === "true" || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (isBuildPhase) {
        return NextResponse.json({ status: "Build Phase OK" });
    }

    // Grab the first chunk from any document
    const snapshot = await db.collectionGroup("chunks").limit(1).get();

    if (snapshot.empty) {
        return NextResponse.json({ status: "EMPTY — no chunks in Firestore at all" });
    }

    const doc = snapshot.docs[0];
    const data = doc.data();
    const embedding = data.embedding;

    const vectorArray: number[] = embedding.toArray();

    return NextResponse.json({
        status: "FOUND",
        path: doc.ref.path,
        isVectorType: embedding?.constructor?.name === "VectorValue", 
        dimensions: vectorArray.length,                               
        preview: vectorArray.slice(0, 5),                            
        allFields: Object.keys(data),
    });
}