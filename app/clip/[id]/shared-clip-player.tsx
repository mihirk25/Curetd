"use client";

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
}: {
  videoId: string;
  startTime: number;
  endTime?: number;
  audioOnly?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const [uiPlaying, setUiPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playbackQuality, setPlaybackQuality] = useState<
    "auto" | "144p" | "240p" | "360p" | "480p" | "720p" | "1080p"
  >("auto");

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
              try {
                p.setPlaybackRate?.(playbackRate);
              } catch {}
              try {
                if (playbackQuality !== "auto") {
                  const map: Record<string, string> = {
                    "144p": "tiny",
                    "240p": "small",
                    "360p": "medium",
                    "480p": "large",
                    "720p": "hd720",
                    "1080p": "hd1080",
                  };
                  p.setPlaybackQuality?.(map[playbackQuality] || "default");
                }
              } catch {}
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

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      p.setPlaybackRate?.(playbackRate);
    } catch {}
  }, [playbackRate]);

  useEffect(() => {
    if (!audioOnly) return;
    const p = playerRef.current;
    const startSeconds = Math.max(0, startTime || 0);
    const hasEnd = endTime != null && endTime > startSeconds;
    const endClipSeconds = hasEnd && endTime != null ? endTime : null;
    if (!p || endClipSeconds == null) return;

    if (!uiPlaying) {
      setElapsed(0);
      return;
    }

    const duration = Math.max(0, endClipSeconds - startSeconds);
    const id = setInterval(() => {
      try {
        const t = Number(p.getCurrentTime?.() ?? 0);
        if (t >= endClipSeconds) {
          p.pauseVideo?.();
          p.seekTo?.(startSeconds, true);
          setUiPlaying(false);
          setElapsed(0);
          return;
        }
        const pos = Math.max(0, t - startSeconds);
        setElapsed(Math.min(duration, pos));
      } catch {}
    }, 500);
    return () => clearInterval(id);
  }, [audioOnly, uiPlaying, startTime, endTime]);

  useEffect(() => {
    if (audioOnly) return;
    const p = playerRef.current;
    if (!p) return;
    const map: Record<string, string> = {
      auto: "default",
      "144p": "tiny",
      "240p": "small",
      "360p": "medium",
      "480p": "large",
      "720p": "hd720",
      "1080p": "hd1080",
    };
    try {
      p.setPlaybackQuality?.(map[playbackQuality] || "default");
    } catch {}
  }, [audioOnly, playbackQuality]);

  useEffect(() => {
    if (audioOnly) return;
    const p = playerRef.current;
    const startSeconds = Math.max(0, startTime || 0);
    const hasEnd = endTime != null && endTime > startSeconds;
    const endClipSeconds = hasEnd && endTime != null ? endTime : null;
    if (!p || endClipSeconds == null) return;

    if (!uiPlaying) {
      setElapsed(0);
      return;
    }
    const duration = Math.max(0, endClipSeconds - startSeconds);
    const id = setInterval(() => {
      try {
        const t = Number(p.getCurrentTime?.() ?? 0);
        if (t >= endClipSeconds) {
          p.pauseVideo?.();
          p.seekTo?.(startSeconds, true);
          setUiPlaying(false);
          setElapsed(0);
          return;
        }
        const pos = Math.max(0, t - startSeconds);
        setElapsed(Math.min(duration, pos));
      } catch {}
    }, 500);
    return () => clearInterval(id);
  }, [audioOnly, uiPlaying, startTime, endTime]);

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    const startSeconds = Math.max(0, startTime || 0);
    try {
      p.setPlaybackRate?.(playbackRate);
    } catch {}
    if (uiPlaying) p.pauseVideo?.();
    else {
      p.seekTo?.(startSeconds, true);
      p.playVideo?.();
    }
  };

  const startSeconds = Math.max(0, startTime || 0);
  const hasEnd = endTime != null && endTime > startSeconds;
  const endClipSeconds = hasEnd && endTime != null ? endTime : null;
  const duration =
    endClipSeconds != null ? Math.max(0, Number(endClipSeconds) - Number(startSeconds)) : 0;
  const fraction = duration > 0 ? Math.max(0, Math.min(1, elapsed / duration)) : 0;
  const thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  const formatMMSS = (totalSeconds: number) => {
    const s = Math.max(0, Math.floor(totalSeconds || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  };

  return (
    <div className="w-full">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-zinc-800 bg-black">
        <div ref={wrapperRef} className={`absolute inset-0 h-full w-full ${audioOnly ? "z-0" : ""}`} />

        {audioOnly ? (
          <div className="absolute inset-0 z-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
              }}
            />
            <div className="absolute inset-0 bg-black/55" />
            <button
              type="button"
              onClick={togglePlay}
              className="absolute inset-0 flex items-center justify-center"
              aria-label={uiPlaying ? "Pause audio clip" : "Play audio clip"}
            >
              <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-white/25 bg-black/35 text-white backdrop-blur-sm">
                <span aria-hidden className="text-xl font-semibold">
                  {uiPlaying ? "❚❚" : "▶"}
                </span>
              </span>
            </button>
          </div>
        ) : null}
      </div>

      {audioOnly ? (
        <div className="mt-3 rounded-2xl border border-zinc-800 bg-black/30 p-3">
          <button
            type="button"
            onClick={(e) => {
              const p = playerRef.current;
              if (!p || duration <= 0) return;
              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
              const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
              const seekPos = (x / rect.width) * duration;
              try {
                p.seekTo?.(startSeconds + seekPos, true);
              } catch {}
              setElapsed(Math.max(0, Math.min(duration, seekPos)));
            }}
            className="block w-full"
            aria-label="Seek audio clip"
          >
            <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-white/70" style={{ width: `${fraction * 100}%` }} />
            </div>
          </button>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold text-zinc-200 tabular-nums">
              {formatMMSS(elapsed)} / {formatMMSS(duration)}
            </div>
            <div className="flex items-center gap-1.5">
              {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setPlaybackRate(r)}
                  className={`rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors ${
                    playbackRate === r
                      ? "border-white/30 bg-white text-black"
                      : "border-zinc-700 bg-black/20 text-zinc-300 hover:border-zinc-500"
                  }`}
                  aria-label={`Set speed ${r}x`}
                >
                  {r}x
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {!audioOnly ? (
        <div className="mt-3 rounded-2xl border border-zinc-800 bg-black/30 p-3">
          <button
            type="button"
            onClick={(e) => {
              const p = playerRef.current;
              if (!p || duration <= 0) return;
              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
              const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
              const seekPos = (x / rect.width) * duration;
              try {
                p.seekTo?.(startSeconds + seekPos, true);
              } catch {}
              setElapsed(Math.max(0, Math.min(duration, seekPos)));
            }}
            className="block w-full"
            aria-label="Seek clip"
          >
            <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-white/70" style={{ width: `${fraction * 100}%` }} />
            </div>
          </button>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold text-zinc-200 tabular-nums">
              {formatMMSS(elapsed)} / {formatMMSS(duration)}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
