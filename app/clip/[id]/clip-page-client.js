"use client";

/**
 * Client-rendered clip UI. OG/social metadata is set server-side in page.tsx.
 */
import React, { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
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

async function fetchClipWithCurator(id) {
  const snap = await getDoc(doc(db, "clips", id));
  if (!snap.exists()) return null;

  const data = snap.data() || {};
  const clip = { id: snap.id, ...data };
  let username = normalizeUsername(clip.username);
  if (username || !clip.userId) {
    return { ...clip, username };
  }

  try {
    const userSnap = await getDoc(doc(db, "publicProfiles", clip.userId));
    const userData = userSnap.exists() ? userSnap.data() : null;
    username = normalizeUsername(userData == null ? null : userData.username);
  } catch {
    username = null;
  }
  return { ...clip, username };
}

function formatTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function ClipPageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = typeof params?.id === "string" ? params.id : null;
  const clipPlayerRef = useRef(null);

  const audioParam = searchParams?.get("audio");
  const audioOnlyFromParam =
    audioParam === "1" ||
    audioParam === "true" ||
    (Array.isArray(audioParam) && audioParam.some((v) => v === "1" || v === "true"));

  const [clip, setClip] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | not_found | error | forbidden | invalid

  useEffect(() => {
    if (!id) {
      setClip(null);
      setStatus("invalid");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setClip(null);

    (async () => {
      try {
        const data = await fetchClipWithCurator(id);
        if (cancelled) return;
        if (!data) {
          setClip(null);
          setStatus("not_found");
          return;
        }
        setClip(data);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        const code = e && typeof e === "object" && "code" in e ? String(e.code) : "";
        if (code === "permission-denied") {
          setClip(null);
          setStatus("forbidden");
        } else {
          setClip(null);
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const audioOnly = audioOnlyFromParam || clip?.audioOnly === true;
  const primary = clip ? getPrimaryMoment(clip) : null;
  const startSeconds = clip
    ? Math.max(0, Number(primary?.startTime ?? clip.startTime ?? 0) || 0)
    : 0;
  const endRaw = primary?.endTime ?? clip?.endTime ?? 0;
  const endSeconds =
    clip && typeof endRaw === "number" && endRaw > startSeconds ? endRaw : undefined;
  const tags = clip ? clipTopicTags(clip) : [];
  const videoId = clip ? clip.videoId || extractVideoId(clip.videoUrl || clip.url) : null;

  const youtubeWatchUrl =
    videoId != null && videoId !== ""
      ? `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(startSeconds)}s`
      : null;

  if (!id || status === "invalid") {
    return (
      <main className="min-h-screen bg-black px-6 py-16 font-sans text-white">
        <div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center">
          <h1 className="text-xl font-bold">Invalid link</h1>
          <p className="mt-2 text-sm text-zinc-500">Missing clip id.</p>
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

  if (status === "loading") {
    return (
      <main className="min-h-screen bg-black px-6 py-16 font-sans text-white">
        <div className="mx-auto max-w-4xl py-20 text-center text-sm text-zinc-500">Loading…</div>
      </main>
    );
  }

  if (status === "forbidden") {
    return (
      <main className="min-h-screen bg-black px-6 py-16 font-sans text-white">
<div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center">
          <h1 className="text-xl font-bold">Can&apos;t load this clip</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Firestore denied access. Try signing in, or check your connection.
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

  if (status === "error") {
    return (
      <main className="min-h-screen bg-black px-6 py-16 font-sans text-white">
<div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center">
          <h1 className="text-xl font-bold">Something went wrong</h1>
          <p className="mt-2 text-sm text-zinc-500">Could not load this clip. Try again.</p>
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

  if (status === "not_found" || !clip) {
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
                  ref={clipPlayerRef}
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
                    <button
                      type="button"
                      onClick={() => {
                        clipPlayerRef.current?.seekToAndPlay?.(startSeconds);
                      }}
                      className="text-[11px] font-mono font-semibold bg-emerald-500 text-white px-2.5 py-0.5 rounded-md hover:bg-emerald-400 transition-colors cursor-pointer"
                      title="Jump to clip start and play"
                      aria-label="Jump to clip start and play"
                    >
                      {formatTimestamp(startSeconds)}
                      {endSeconds != null ? ` – ${formatTimestamp(endSeconds)}` : ""}
                    </button>
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

export default function SharedClipPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-black px-6 py-16 font-sans text-white">
<div className="mx-auto max-w-4xl py-20 text-center text-sm text-zinc-500">Loading…</div>
        </main>
      }
    >
      <ClipPageInner />
    </Suspense>
  );
}
