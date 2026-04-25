import { NextResponse } from "next/server";
import admin, { db } from "@/lib/firebaseAdmin";

export async function GET() {
    // Grab the first chunk from any document
    const snapshot = await db.collectionGroup("chunks").limit(1).get();

    if (snapshot.empty) {
        return NextResponse.json({ status: "EMPTY — no chunks in Firestore at all" });
    }

    const doc = snapshot.docs[0];
    const data = doc.data();
    const embedding = data.embedding;

    // FieldValue.vector() stores as a VectorValue object
    // .toArray() is the correct way to read it back
    const vectorArray: number[] = embedding.toArray();

    return NextResponse.json({
        status: "FOUND",
        path: doc.ref.path,
        isVectorType: embedding?.constructor?.name === "VectorValue", // should be true
        dimensions: vectorArray.length,                               // should be 768
        preview: vectorArray.slice(0, 5),                            // first 5 numbers
        allFields: Object.keys(data),
    });
}