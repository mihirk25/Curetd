"use client";

import React, { useEffect, useMemo } from "react";
import { buildClipModalPlayback } from "../lib/clip-playback";

export function ClipYoutubeModal({
  clip,
  onClose,
}: {
  clip: Record<string, any> | null | undefined;
  onClose: () => void;
}) {
  const playback = useMemo(() => buildClipModalPlayback(clip ?? null), [clip]);

  useEffect(() => {
    if (!clip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clip, onClose]);

  if (!clip || !playback) return null;

  const iframeKey =
    clip.__repost && clip.__repostDocId
      ? `${clip.id}__repost__${clip.__repostDocId}`
      : String(clip.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="max-w-4xl w-full px-4"
        role="dialog"
        aria-modal="true"
        aria-label="Clip player"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="mb-2 rounded-lg px-3 py-1 text-2xl leading-none text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <iframe
          key={iframeKey}
          src={playback.embedUrl}
          title={playback.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="aspect-video w-full rounded-xl border-0"
        />
        <div className="mt-4 space-y-2">
          <div className="text-lg font-semibold text-white">{playback.title}</div>
          <div className="text-sm text-zinc-400">{playback.channel}</div>
          <a
            href={playback.originalYouTubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
          >
            ↗ Watch full video on YouTube
          </a>
          <div className="text-xs text-zinc-500">{playback.rangeLabel}</div>
        </div>
      </div>
    </div>
  );
}
