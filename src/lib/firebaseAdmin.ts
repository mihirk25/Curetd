import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function normalizePrivateKey(v: string) {
  // Vercel stores multiline env vars with literal \n.
  return v.replace(/\\n/g, "\n");
}

export function getAdminDb() {
  if (getApps().length === 0) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (projectId && clientEmail && privateKey) {
      initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: normalizePrivateKey(privateKey),
        }),
      });
    } else {
      // Fallback for GOOGLE_APPLICATION_CREDENTIALS or local gcloud auth.
      initializeApp({ credential: applicationDefault() });
    }
  }

  return getFirestore();
}

