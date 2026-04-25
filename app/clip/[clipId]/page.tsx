import type { Metadata } from "next";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../firebase";

type ClipPageProps = {
  params: Promise<{ clipId: string }>;
};

type ClipDoc = {
  id: string;
  url?: string;
  videoId?: string;
  title?: string;
  channel?: string;
  note?: string;
  topic?: string;
  username?: string | null;
  userId?: string;
  userDisplayName?: string;
  startTime?: number;
  endTime?: number;
  displayStart?: string;
  displayEnd?: string;
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

  const videoId = clip.videoId || extractVideoId(clip.url);
  const title = clip.title || "Curatd clip";
  const description = clip.note || `A YouTube moment curated on Curatd.`;
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

  const videoId = clip.videoId || extractVideoId(clip.url);
  const startTime = Math.max(0, Math.floor(clip.startTime || 0));
  const endTime = clip.endTime && clip.endTime > startTime ? Math.floor(clip.endTime) : undefined;
  const embedUrl = videoId
    ? `https://www.youtube.com/embed/${videoId}?start=${startTime}${endTime ? `&end=${endTime}` : ""}&rel=0&iv_load_policy=3`
    : "";
  const curator = clip.username ? `@${clip.username}` : clip.userDisplayName || "Unknown curator";

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

        <article className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/25">
          <div className="relative aspect-video bg-zinc-950">
            {embedUrl ? (
              <iframe
                src={embedUrl}
                title={clip.title || "Curatd clip"}
                className="absolute inset-0 h-full w-full"
                allowFullScreen
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
                Video unavailable
              </div>
            )}
          </div>

          <div className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2">
              {clip.topic ? (
                <span className="rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-200">
                  {clip.topic}
                </span>
              ) : null}
              <span className="rounded-md bg-emerald-500 px-2.5 py-1 text-[11px] font-mono font-semibold text-white">
                {endTime ? `${clip.displayStart || "0:00"} — ${clip.displayEnd || ""}` : "Full video"}
              </span>
            </div>

            <h1 className="mt-5 text-2xl sm:text-3xl font-bold leading-tight">{clip.title || "Untitled clip"}</h1>
            <p className="mt-2 text-sm text-zinc-500">{clip.channel || "Unknown channel"}</p>

            <div className="mt-4 text-sm text-zinc-500">
              Curated by{" "}
              {clip.username ? (
                <Link href={`/${clip.username}`} className="font-medium text-zinc-200 hover:text-emerald-400 hover:underline">
                  {curator}
                </Link>
              ) : (
                <span className="font-medium text-zinc-200">{curator}</span>
              )}
            </div>

            {clip.note ? (
              <blockquote className="mt-6 border-l-2 border-emerald-500 pl-4 text-lg font-medium italic text-zinc-100">
                &ldquo;{clip.note}&rdquo;
              </blockquote>
            ) : null}

            {clip.username ? (
              <Link
                href={`/${clip.username}`}
                className="mt-8 inline-flex rounded-full bg-white px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-zinc-200"
              >
                View more from @{clip.username}
              </Link>
            ) : null}
          </div>
        </article>
      </div>
    </main>
  );
}
