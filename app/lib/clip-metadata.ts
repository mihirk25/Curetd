import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase";
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

async function resolveUsername(
  data: Record<string, unknown>,
  fetchUser: (userId: string) => Promise<string | null>,
): Promise<string | null> {
  let username = normalizeUsername(data.username);
  if (username || typeof data.userId !== "string" || !data.userId) {
    return username;
  }
  try {
    return await fetchUser(data.userId);
  } catch {
    return null;
  }
}

async function fetchClipViaAdmin(id: string): Promise<ClipForMetadata | null> {
  const adminDb = getAdminDb();
  const snap = await adminDb.collection("clips").doc(id).get();
  if (!snap.exists) return null;

  const data = snap.data() || {};
  const username = await resolveUsername(data, async (userId) => {
    const userSnap = await adminDb.collection("users").doc(userId).get();
    return userSnap.exists ? normalizeUsername(userSnap.data()?.username) : null;
  });

  return { id: snap.id, ...data, username } as ClipForMetadata;
}

/** Public read — works when Admin env vars are missing (e.g. Vercel). */
async function fetchClipViaClientSdk(id: string): Promise<ClipForMetadata | null> {
  const snap = await getDoc(doc(db, "clips", id));
  if (!snap.exists()) return null;

  const data = snap.data() || {};
  const username = await resolveUsername(data, async (userId) => {
    const userSnap = await getDoc(doc(db, "publicProfiles", userId));
    return userSnap.exists() ? normalizeUsername(userSnap.data()?.username) : null;
  });

  return { id: snap.id, ...data, username } as ClipForMetadata;
}

export async function getClipForMetadata(id: string): Promise<ClipForMetadata | null> {
  if (!id) return null;

  if (isAdminConfigured()) {
    try {
      const clip = await fetchClipViaAdmin(id);
      if (clip) return clip;
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[getClipForMetadata] Admin fetch failed, trying client SDK:", err);
      }
    }
  } else if (process.env.NODE_ENV === "development") {
    console.warn(
      "[getClipForMetadata] Admin not configured; using public Firestore client read.",
    );
  }

  try {
    return await fetchClipViaClientSdk(id);
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error(`[getClipForMetadata] Client SDK read failed for clips/${id}:`, err);
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
