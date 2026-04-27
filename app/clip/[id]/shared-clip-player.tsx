"use client";

import React, { useEffect, useRef } from "react";

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
}: {
  videoId: string;
  startTime: number;
  endTime?: number;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);

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
              if (event?.data === YT.PlayerState.PLAYING) {
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
  }, [videoId, startTime, endTime]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-zinc-800 bg-black">
      <div ref={wrapperRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
