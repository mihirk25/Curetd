import { getAdminDb } from "../../src/lib/firebaseAdmin";
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
  try {
    const adminDb = getAdminDb();
    const snap = await adminDb.collection("clips").doc(id).get();
    if (!snap.exists) return null;

    const data = snap.data() || {};
    let username = normalizeUsername(data.username);

    if (!username && typeof data.userId === "string" && data.userId) {
      try {
        const userSnap = await adminDb.collection("users").doc(data.userId).get();
        if (userSnap.exists) {
          username = normalizeUsername(userSnap.data()?.username);
        }
      } catch {
        // optional username lookup
      }
    }

    return { id: snap.id, ...data, username } as ClipForMetadata;
  } catch {
    return null;
  }
}

export function buildClipShareMetadata(clip: ClipForMetadata) {
  const videoId =
    (typeof clip.videoId === "string" && clip.videoId) ||
    extractVideoId(clip.videoUrl || clip.url || "") ||
    null;

  const note = primaryNote(clip);
  const title =
    (typeof clip.title === "string" && clip.title.trim()) ||
    note ||
    "Curatd clip";

  const handle = clip.username || "unknown";
  const description = `Curated by @${handle} on Curatd`;
  const url = `https://curatd.live/clip/${clip.id}`;
  const image = videoId
    ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
    : undefined;

  return { title, description, url, image, videoId };
}
