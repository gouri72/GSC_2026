
import admin from "firebase-admin";

const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

// Only initialize if we aren't already initialized AND we have the key
if (!admin.apps.length) {
  if (serviceAccountVar) {
    try {
      const serviceAccount = JSON.parse(serviceAccountVar);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log("Firebase Admin initialized successfully.");
    } catch (e) {
      console.error("Firebase Admin init failed:", e);
    }
  } else {
    // This is what will happen during the Google Cloud Build
    console.warn("Skipping Firebase initialization: FIREBASE_SERVICE_ACCOUNT_JSON is missing.");
  }
}

export const db = admin.firestore();
export default admin;