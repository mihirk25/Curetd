import type { Metadata } from "next";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import { ClipDetailClient } from "./clip-detail-client";

type ClipPageProps = {
  params: Promise<{ clipId: string }>;
};

type ClipDoc = {
  id: string;
  url?: string;
  videoUrl?: string;
  videoId?: string;
  title?: string;
  channel?: string;
  channelName?: string;
  note?: string;
  topic?: string;
  username?: string | null;
  userId?: string;
  userDisplayName?: string;
  startTime?: number;
  endTime?: number;
  displayStart?: string;
  displayEnd?: string;
  displayName?: string;
  moments?: any[];
};

function extractVideoId(url?: string) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function normalizeUsername(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

async function getClip(clipId: string) {
  const snap = await getDoc(doc(db, "clips", clipId));
  if (!snap.exists()) return null;

  const data = snap.data() as Omit<ClipDoc, "id">;
  const clip: ClipDoc = { id: snap.id, ...data };
  const username = normalizeUsername(clip.username);
  if (username || !clip.userId) return { ...clip, username };

  try {
    const userSnap = await getDoc(doc(db, "users", clip.userId));
    const userData = userSnap.exists() ? userSnap.data() : null;
    return { ...clip, username: normalizeUsername((userData as any)?.username) };
  } catch {
    return { ...clip, username: null };
  }
}

function thumbnailUrl(videoId: string | null) {
  return videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : undefined;
}

export async function generateMetadata({ params }: ClipPageProps): Promise<Metadata> {
  const { clipId } = await params;
  const clip = await getClip(clipId);
  if (!clip) {
    return {
      title: "Clip not found | Curatd",
      description: "This Curatd clip could not be found.",
    };
  }

  const videoId = clip.videoId || extractVideoId(clip.videoUrl || clip.url);
  const title = clip.title || "Curatd clip";
  const moments = Array.isArray((clip as any).moments) ? ((clip as any).moments as any[]) : null;
  const primary = moments && moments.length > 0 ? moments[0] : null;
  const description = (primary?.note as string | undefined) || clip.note || `A YouTube moment curated on Curatd.`;
  const url = `https://curetd.vercel.app/clip/${clip.id}`;
  const image = thumbnailUrl(videoId);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      type: "article",
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ClipPage({ params }: ClipPageProps) {
  const { clipId } = await params;
  const clip = await getClip(clipId);

  if (!clip) {
    return (
      <main className="min-h-screen bg-black text-white font-sans flex items-center justify-center px-6">
        <div className="max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center">
          <h1 className="text-xl font-bold">Clip not found</h1>
          <p className="mt-2 text-sm text-zinc-500">This shared Curatd clip does not exist or is no longer available.</p>
          <Link href="/" className="mt-6 inline-block text-sm font-semibold text-emerald-500 hover:text-emerald-400">
            Back to feed
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white font-sans">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link href="/" className="text-sm font-bold tracking-tight text-white hover:text-zinc-200 transition-colors">
            CURATD
          </Link>
          <Link href="/" className="text-sm text-zinc-500 hover:text-white transition-colors">
            Back to feed
          </Link>
        </div>

        <ClipDetailClient clip={clip as any} videoId={clip.videoId || extractVideoId(clip.videoUrl || clip.url)} />
      </div>
    </main>
  );
}
