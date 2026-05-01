import Link from "next/link";
import { headers } from "next/headers";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import { SharedClipPlayer } from "./shared-clip-player";
import { ShareActionsRow } from "./share-actions-row";

function extractVideoId(url) {
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

function normalizeUsername(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function getPrimaryMoment(clip) {
  const moments = Array.isArray(clip.moments) ? clip.moments : [];
  if (moments.length > 0) return moments[0];
  return {
    startTime: clip.startTime ?? 0,
    endTime: clip.endTime ?? 0,
    note: clip.note ?? "",
    topic: clip.topic ?? "",
  };
}

function clipTopicTags(clip) {
  const moments = Array.isArray(clip.moments) ? clip.moments : [];
  const tags = new Set();
  for (const m of moments) {
    const t = typeof (m == null ? undefined : m.topic) === "string" ? m.topic.trim() : "";
    if (t) tags.add(t);
  }
  const legacy = typeof clip.topic === "string" ? clip.topic.trim() : "";
  if (legacy) tags.add(legacy);
  return [...tags];
}

async function getClip(id) {
  const snap = await getDoc(doc(db, "clips", id));
  if (!snap.exists()) return null;

  const data = snap.data() || {};
  const clip = { id: snap.id, ...data };
  let username = normalizeUsername(clip.username);
  if (username || !clip.userId) {
    return { ...clip, username };
  }

  try {
    const userSnap = await getDoc(doc(db, "users", clip.userId));
    const userData = userSnap.exists() ? userSnap.data() : null;
    username = normalizeUsername(userData == null ? null : userData.username);
  } catch {
    username = null;
  }
  return { ...clip, username };
}

function thumbnailUrl(videoId) {
  return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : undefined;
}

export async function generateMetadata({ params }) {
  const { id } = params;
  const clip = await getClip(id);
  if (!clip) {
    return {
      title: "Clip not found | Curatd",
      description: "This Curatd clip could not be found.",
    };
  }

  const videoId = clip.videoId || extractVideoId(clip.videoUrl || clip.url);
  const title = clip.title || "Curatd clip";
  const tags = clipTopicTags(clip);
  const handle = clip.username ? `@${clip.username}` : "@unknown";
  const description = `Curated by ${handle}${tags.length > 0 ? ` · ${tags.join(", ")}` : ""}`;
  const h = headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "https";
  const origin = host ? `${proto}://${host}` : "https://curatd.vercel.app";
  const url = `${origin}/clip/${clip.id}`;
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
  };
}

function formatTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default async function SharedClipPage({ params, searchParams }) {
  const { id } = params;
  const audioParam = searchParams == null ? undefined : searchParams.audio;
  const audioOnlyFromParam =
    audioParam === "1" ||
    audioParam === "true" ||
    (Array.isArray(audioParam) && audioParam.some((v) => v === "1" || v === "true"));

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

  const audioOnly = audioOnlyFromParam || clip.audioOnly === true;
  const videoId = clip.videoId || extractVideoId(clip.videoUrl || clip.url);
  const primary = getPrimaryMoment(clip);
  const startSeconds = Math.max(0, Number(primary == null ? 0 : primary.startTime ?? clip.startTime ?? 0) || 0);
  const endRaw = (primary == null ? undefined : primary.endTime) ?? clip.endTime ?? 0;
  const endSeconds = typeof endRaw === "number" && endRaw > startSeconds ? endRaw : undefined;
  const tags = clipTopicTags(clip);

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

        <div
          className={`group relative rounded-2xl border transition-colors overflow-hidden ${
            audioOnly ? "bg-zinc-950/80" : "bg-zinc-900/30"
          } border-zinc-800/70 hover:border-zinc-700`}
        >
          <div className="border-b border-zinc-800 rounded-t-2xl overflow-hidden">
            {videoId ? (
              <SharedClipPlayer
                videoId={videoId}
                startTime={startSeconds}
                endTime={endSeconds}
                audioOnly={audioOnly}
              />
            ) : (
              <div className="aspect-video w-full bg-zinc-950 px-6 py-16 text-center text-sm text-zinc-500">
                Video unavailable (missing YouTube ID).
              </div>
            )}
          </div>

          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-semibold text-white leading-snug line-clamp-2">
                  {clip.title || "Untitled clip"}
                </div>

                <ShareActionsRow clipId={String(clip.id)} originalCuratorId={String(clip.userId || "")} />

                <div className="text-sm text-zinc-500 mt-1 truncate">
                  {clip.channelName || clip.channel || "Unknown channel"}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-mono font-semibold bg-emerald-500 text-white px-2.5 py-0.5 rounded-md">
                    {formatTimestamp(startSeconds)}
                    {endSeconds != null ? ` – ${formatTimestamp(endSeconds)}` : ""}
                  </span>
                </div>

                {tags.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {tags.slice(0, 12).map((t) => (
                      <span
                        key={t}
                        className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-2 text-xs text-zinc-500">
                  Curated by{" "}
                  {clip.username ? (
                    <Link href={`/${clip.username}`} className="font-medium text-zinc-300 hover:underline">
                      @{clip.username}
                    </Link>
                  ) : (
                    <span className="text-zinc-300 font-medium">Unknown curator</span>
                  )}
                </div>

                {audioOnly ? (
                  <div className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-purple-300/80">
                    Audio only
                  </div>
                ) : null}

                <div className="mt-4 flex items-center gap-4 text-xs">
                  {youtubeWatchUrl ? (
                    <a
                      href={youtubeWatchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-500 hover:text-zinc-200 hover:underline underline-offset-2"
                    >
                      Watch full video on YouTube
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

