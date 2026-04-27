import type { Metadata } from "next";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import { SharedClipPlayer } from "./shared-clip-player";

type Props = {
  params: Promise<{ id: string }>;
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
  startTime?: number;
  endTime?: number;
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

function getPrimaryMoment(clip: ClipDoc) {
  const moments = Array.isArray(clip.moments) ? clip.moments : [];
  if (moments.length > 0) return moments[0];
  return {
    startTime: clip.startTime ?? 0,
    endTime: clip.endTime ?? 0,
    note: clip.note ?? "",
    topic: clip.topic ?? "",
  };
}

async function getClip(id: string): Promise<(ClipDoc & { username: string | null }) | null> {
  const snap = await getDoc(doc(db, "clips", id));
  if (!snap.exists()) return null;

  const data = snap.data() as Omit<ClipDoc, "id">;
  const clip: ClipDoc = { id: snap.id, ...data };
  let username = normalizeUsername(clip.username);
  if (username || !clip.userId) {
    return { ...clip, username };
  }

  try {
    const userSnap = await getDoc(doc(db, "users", clip.userId));
    const userData = userSnap.exists() ? userSnap.data() : null;
    username = normalizeUsername((userData as { username?: string })?.username);
  } catch {
    username = null;
  }
  return { ...clip, username };
}

function thumbnailUrl(videoId: string | null) {
  return videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : undefined;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const clip = await getClip(id);
  if (!clip) {
    return {
      title: "Clip not found | Curatd",
      description: "This Curatd clip could not be found.",
    };
  }

  const videoId = clip.videoId || extractVideoId(clip.videoUrl || clip.url);
  const title = clip.title || "Curatd clip";
  const primary = getPrimaryMoment(clip);
  const description =
    (typeof primary?.note === "string" && primary.note.trim()) ||
    clip.note ||
    "A YouTube moment curated on Curatd.";
  const url = `https://curatd.vercel.app/clip/${clip.id}`;
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

export default async function SharedClipPage({ params }: Props) {
  const { id } = await params;
  const clip = await getClip(id);

  if (!clip) {
    return (
      <main className="min-h-screen bg-black px-6 py-16 font-sans text-white">
        <div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center">
          <h1 className="text-xl font-bold">Clip not found</h1>
          <p className="mt-2 text-sm text-zinc-500">
            This clip does not exist or is no longer available.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block text-sm font-semibold text-emerald-500 hover:text-emerald-400"
          >
            Back to feed
          </Link>
        </div>
      </main>
    );
  }

  const videoId = clip.videoId || extractVideoId(clip.videoUrl || clip.url);
  const primary = getPrimaryMoment(clip);
  const startSeconds = Math.max(0, Number(primary?.startTime ?? clip.startTime ?? 0) || 0);
  const endRaw = primary?.endTime ?? clip.endTime ?? 0;
  const endSeconds =
    typeof endRaw === "number" && endRaw > startSeconds ? endRaw : undefined;
  const noteText =
    (typeof primary?.note === "string" && primary.note.trim()) ||
    (typeof clip.note === "string" && clip.note.trim()) ||
    "";

  const youtubeWatchUrl =
    videoId != null && videoId !== ""
      ? `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(startSeconds)}s`
      : null;

  return (
    <main className="min-h-screen bg-black font-sans text-white">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="text-sm font-bold tracking-tight text-white hover:text-zinc-200">
            CURATD
          </Link>
          <Link href="/" className="text-sm text-zinc-500 transition-colors hover:text-white">
            Back to feed
          </Link>
        </div>

        {videoId ? (
          <SharedClipPlayer videoId={videoId} startTime={startSeconds} endTime={endSeconds} />
        ) : (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-6 py-16 text-center text-sm text-zinc-500">
            Video unavailable (missing YouTube ID).
          </div>
        )}

        {noteText ? (
          <blockquote className="mt-8 border-l-4 border-emerald-500 pl-5 text-lg font-medium leading-relaxed text-zinc-100">
            &ldquo;{noteText}&rdquo;
          </blockquote>
        ) : null}

        <div className="mt-8 flex flex-col gap-4 border-t border-zinc-800 pt-8 text-sm">
          <p className="text-zinc-400">
            Curated by{" "}
            {clip.username ? (
              <Link
                href={`/${clip.username}`}
                className="font-semibold text-emerald-400 hover:text-emerald-300 hover:underline"
              >
                @{clip.username}
              </Link>
            ) : (
              <span className="font-semibold text-zinc-300">Unknown curator</span>
            )}
          </p>

          {youtubeWatchUrl ? (
            <p>
              <a
                href={youtubeWatchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-500 underline-offset-2 hover:text-emerald-400 hover:underline"
              >
                Watch full video on YouTube
              </a>
            </p>
          ) : null}

          {clip.title ? (
            <p className="text-xs text-zinc-600">
              {clip.title}
              {clip.channelName || clip.channel ? (
                <span className="text-zinc-600"> · {clip.channelName || clip.channel}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
