import { getAdminDb, isAdminConfigured } from "@/lib/firebase-admin";
import { extractVideoId } from "./clip-playback";

export type ClipForMetadata = {
  id: string;
  title?: string;
  videoId?: string;
  videoUrl?: string;
  url?: string;
  username?: string | null;
  userId?: string;
  note?: string;
  moments?: Array<{ note?: string }>;
};

function normalizeUsername(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function primaryNote(clip: ClipForMetadata) {
  const moments = Array.isArray(clip.moments) ? clip.moments : [];
  if (moments.length > 0) {
    const note = moments[0]?.note;
    if (typeof note === "string" && note.trim()) return note.trim();
  }
  if (typeof clip.note === "string" && clip.note.trim()) return clip.note.trim();
  return null;
}

export async function getClipForMetadata(id: string): Promise<ClipForMetadata | null> {
  if (!id) return null;

  if (!isAdminConfigured()) {
    if (process.env.NODE_ENV === "development") {
      console.error(
        "[getClipForMetadata] Firebase Admin env vars missing (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).",
      );
    }
    return null;
  }

  try {
    const adminDb = getAdminDb();
    const snap = await adminDb.collection("clips").doc(id).get();
    if (!snap.exists) {
      if (process.env.NODE_ENV === "development") {
        console.warn(`[getClipForMetadata] No document at clips/${id}`);
      }
      return null;
    }

    const data = snap.data() || {};
    let username = normalizeUsername(data.username);

    if (!username && typeof data.userId === "string" && data.userId) {
      try {
        const userSnap = await adminDb.collection("users").doc(data.userId).get();
        if (userSnap.exists) {
          username = normalizeUsername(userSnap.data()?.username);
        }
      } catch (userErr) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[getClipForMetadata] Username lookup failed:", userErr);
        }
      }
    }

    return { id: snap.id, ...data, username } as ClipForMetadata;
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error(`[getClipForMetadata] Failed to read clips/${id}:`, err);
    }
    return null;
  }
}

export function buildClipShareMetadata(clip: ClipForMetadata) {
  const videoId =
    (typeof clip.videoId === "string" && clip.videoId.trim()) ||
    extractVideoId(clip.videoUrl || clip.url || "") ||
    null;

  const note = primaryNote(clip);
  const title =
    (typeof clip.title === "string" && clip.title.trim()) ||
    note ||
    "Curatd";

  const handle = clip.username || "unknown";
  const description = `Curated by @${handle} on Curatd`;
  const image = videoId
    ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
    : undefined;

  return { title, description, image, videoId };
}
