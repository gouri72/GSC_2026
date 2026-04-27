import admin from "firebase-admin";

const isBuildPhase = process.env.NEXT_PHASE === "true";
const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!admin.apps.length && !isBuildPhase && serviceAccountVar) {
  try {
    const serviceAccount = JSON.parse(serviceAccountVar);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (e) {
    console.error("Firebase init failed:", e);
  }
}

// During build phase, we export a proxy or null to prevent the "no-app" error
export const db = (!isBuildPhase && admin.apps.length) 
  ? admin.firestore() 
  : {} as admin.firestore.Firestore; 

export default admin;