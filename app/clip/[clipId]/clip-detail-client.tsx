"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";

type Moment = {
  id: string;
  startTime?: number;
  endTime?: number;
  note?: string;
  topic?: string;
};

type ClipDetailClientProps = {
  clip: {
    id: string;
    videoUrl?: string;
    url?: string;
    videoId?: string;
    title?: string;
    channelName?: string;
    channel?: string;
    username?: string | null;
    displayName?: string | null;
    userDisplayName?: string | null;
    moments?: Moment[] | null;
    startTime?: number;
    endTime?: number;
    note?: string;
    topic?: string;
  };
  videoId: string | null;
};

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function ClipDetailClient({ clip, videoId }: ClipDetailClientProps) {
  const moments = useMemo<Moment[]>(() => {
    if (Array.isArray(clip.moments) && clip.moments.length > 0) return clip.moments;
    return [
      {
        id: `${clip.id}_legacy`,
        startTime: clip.startTime ?? 0,
        endTime: clip.endTime ?? 0,
        note: clip.note ?? "",
        topic: clip.topic ?? "",
      },
    ];
  }, [clip]);

  const [selectedMomentId, setSelectedMomentId] = useState<string>(moments[0]?.id || `${clip.id}_legacy`);
  const selected = moments.find((m) => m.id === selectedMomentId) || moments[0];

  const start = Math.max(0, Math.floor(selected?.startTime ?? 0));
  const endRaw = selected?.endTime ?? 0;
  const end = endRaw && endRaw > start ? Math.floor(endRaw) : undefined;

  const embedUrl = videoId
    ? `https://www.youtube.com/embed/${videoId}?start=${start}${end ? `&end=${end}` : ""}&rel=0&iv_load_policy=3`
    : "";

  const curator =
    clip.username && clip.username.trim()
      ? `@${clip.username.trim().toLowerCase()}`
      : clip.displayName || clip.userDisplayName || "Unknown curator";

  return (
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
          {selected?.topic ? (
            <span className="rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-200">
              {selected.topic}
            </span>
          ) : null}
          <span className="rounded-md bg-emerald-500 px-2.5 py-1 text-[11px] font-mono font-semibold text-white">
            {end ? `${formatTime(start)} — ${formatTime(end)}` : "Full video"}
          </span>
        </div>

        <h1 className="mt-5 text-2xl sm:text-3xl font-bold leading-tight">{clip.title || "Untitled clip"}</h1>
        <p className="mt-2 text-sm text-zinc-500">{clip.channelName || clip.channel || "Unknown channel"}</p>

        <div className="mt-4 text-sm text-zinc-500">
          Curated by{" "}
          {clip.username ? (
            <Link
              href={`/${clip.username}`}
              className="font-medium text-zinc-200 hover:text-emerald-400 hover:underline"
            >
              {curator}
            </Link>
          ) : (
            <span className="font-medium text-zinc-200">{curator}</span>
          )}
        </div>

        {selected?.note ? (
          <blockquote className="mt-6 border-l-2 border-emerald-500 pl-4 text-lg font-medium italic text-zinc-100">
            &ldquo;{selected.note}&rdquo;
          </blockquote>
        ) : null}

        <div className="mt-8">
          <h2 className="text-xs font-bold tracking-wider uppercase text-zinc-500">Moments</h2>
          <div className="mt-3 space-y-2">
            {moments.map((m) => {
              const active = m.id === selectedMomentId;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedMomentId(m.id)}
                  className={`w-full text-left rounded-2xl border px-4 py-3 transition-colors ${
                    active
                      ? "border-emerald-500/50 bg-emerald-500/10"
                      : "border-zinc-800 bg-black/20 hover:bg-zinc-900/40"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {m.topic ? (
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-200 border border-zinc-700/80">
                        {m.topic}
                      </span>
                    ) : null}
                    <span className="text-[11px] font-mono font-semibold bg-emerald-500 text-white px-2.5 py-0.5 rounded-md">
                      {formatTime(m.startTime ?? 0)} – {formatTime(m.endTime ?? 0)}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-zinc-200 line-clamp-2">{m.note || "No note"}</div>
                </button>
              );
            })}
          </div>
        </div>

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
  );
}

