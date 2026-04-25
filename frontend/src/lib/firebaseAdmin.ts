import admin from "firebase-admin";

if (!admin.apps.length) {
  // We use the JSON directly since it has all the keys!
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON as string);

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key,
    }),
  });
}

export const db = admin.firestore();
export default admin;
