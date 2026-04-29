"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function loadYouTubeIframeAPI(): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.YT?.Player) return Promise.resolve(window.YT);

  return new Promise((resolve) => {
    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
  });
}

export function SharedClipPlayer({
  videoId,
  startTime,
  endTime,
  audioOnly = false,
  videoTitle = "Untitled clip",
  curatorUsername = null,
}: {
  videoId: string;
  startTime: number;
  endTime?: number;
  audioOnly?: boolean;
  videoTitle?: string;
  curatorUsername?: string | null;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const [uiPlaying, setUiPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timeGuardInterval: ReturnType<typeof setInterval> | null = null;
    const clearTimeGuard = () => {
      if (timeGuardInterval != null) {
        clearInterval(timeGuardInterval);
        timeGuardInterval = null;
      }
    };

    const startSeconds = Math.max(0, startTime || 0);
    const hasEnd = endTime != null && endTime > startSeconds;
    const endClipSeconds = hasEnd && endTime != null ? endTime : null;

    void (async () => {
      const YT = await loadYouTubeIframeAPI();
      if (cancelled || !YT?.Player || !wrapperRef.current) return;

      const mount = document.createElement("div");
      mount.style.width = "100%";
      mount.style.height = "100%";
      if (audioOnly) {
        mount.style.position = "absolute";
        mount.style.inset = "0";
        mount.style.opacity = "0";
        mount.style.pointerEvents = "none";
      }
      wrapperRef.current.appendChild(mount);
      mountRef.current = mount;

      playerRef.current = new YT.Player(mount, {
        videoId,
        playerVars: {
          autoplay: 0,
          rel: 0,
          iv_load_policy: 3,
        },
        events: {
          onReady: (e: any) => {
            try {
              const p = e?.target;
              if (!p) return;
              if (hasEnd && endClipSeconds != null) {
                p.cueVideoById({
                  videoId,
                  startSeconds,
                  endSeconds: endClipSeconds,
                });
              } else {
                p.cueVideoById({ videoId, startSeconds });
              }
              p.playVideo?.();
            } catch {}
          },
          onStateChange: (event: any) => {
            try {
              const st = event?.data;
              if (st === YT.PlayerState.PLAYING) {
                setUiPlaying(true);
                clearTimeGuard();
                const p = event?.target;
                if (!p) return;
                timeGuardInterval = setInterval(() => {
                  try {
                    const t = p.getCurrentTime?.() ?? 0;
                    if (t < startSeconds) {
                      p.seekTo?.(startSeconds, true);
                      return;
                    }
                    if (hasEnd && endClipSeconds != null && t >= endClipSeconds) {
                      p.pauseVideo?.();
                      p.seekTo?.(startSeconds, true);
                    }
                  } catch {}
                }, 250);
              } else {
                if (st === YT.PlayerState.PAUSED || st === YT.PlayerState.ENDED) {
                  setUiPlaying(false);
                }
                clearTimeGuard();
              }
            } catch {}
          },
        },
      });
    })();

    return () => {
      cancelled = true;
      clearTimeGuard();
      try {
        playerRef.current?.destroy?.();
      } catch {}
      playerRef.current = null;
      try {
        if (mountRef.current?.parentNode) {
          mountRef.current.parentNode.removeChild(mountRef.current);
        }
      } catch {}
      mountRef.current = null;
    };
  }, [videoId, startTime, endTime, audioOnly]);

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (uiPlaying) p.pauseVideo?.();
    else p.playVideo?.();
  };

  const thumb = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-zinc-800 bg-black">
      <div
        ref={wrapperRef}
        className={`absolute inset-0 h-full w-full ${audioOnly ? "z-0" : ""}`}
      />
      {audioOnly ? (
        <div className="absolute inset-0 z-10 flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumb}
            alt=""
            className="h-[52%] min-h-[120px] w-full shrink-0 object-cover sm:h-[55%] sm:min-h-[140px]"
            onError={(e) => {
              (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
            }}
          />
          <div className="flex min-h-0 flex-1 flex-col justify-between gap-3 p-4">
            <div>
              <h2 className="line-clamp-2 text-base font-bold leading-snug text-white sm:text-lg">{videoTitle}</h2>
              {curatorUsername ? (
                <p className="mt-1 text-sm">
                  <Link
                    href={`/${curatorUsername}`}
                    className="font-semibold text-emerald-400 hover:text-emerald-300 hover:underline"
                  >
                    @{curatorUsername}
                  </Link>
                </p>
              ) : (
                <p className="mt-1 text-sm text-zinc-500">Unknown curator</p>
              )}
            </div>
            <button
              type="button"
              onClick={togglePlay}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-600 bg-zinc-900 py-3 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              {uiPlaying ? "Pause" : "Play"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
