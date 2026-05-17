/** Shared helpers for YouTube clip embeds (profile + collection pages). */

export function extractVideoId(url: string) {
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

export function toSeconds(t: string): number {
  const parts = t.split(":").map(Number);
  const v = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
  return Number.isFinite(v) ? v : 0;
}

export function formatTimestamp(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

const YT_THUMB_QUALITY = {
  max: "maxresdefault",
  hq: "hqdefault",
  mq: "mqdefault",
} as const;

export function youtubeThumbnailUrl(
  videoId: string,
  quality: keyof typeof YT_THUMB_QUALITY = "max",
) {
  return `https://img.youtube.com/vi/${videoId}/${YT_THUMB_QUALITY[quality]}.jpg`;
}

/** YouTube returns a tiny 120×90 placeholder when maxres is missing (still HTTP 200, so no onError). */
const YOUTUBE_MAXRES_MIN_WIDTH = 480;

function applyYoutubeThumbnailHqFallback(img: HTMLImageElement, videoId: string) {
  const hq = youtubeThumbnailUrl(videoId, "hq");
  if (!img.src.includes("/hqdefault.jpg")) {
    img.src = hq;
  }
}

/** Use on <img onError> — falls back from maxresdefault to hqdefault. */
export function onYoutubeThumbnailError(
  event: { currentTarget: HTMLImageElement },
  videoId: string,
) {
  applyYoutubeThumbnailHqFallback(event.currentTarget, videoId);
}

/** Use on <img onLoad> with maxres — swaps to hqdefault if the loaded image is too small. */
export function onYoutubeThumbnailLoad(
  event: { currentTarget: HTMLImageElement },
  videoId: string,
) {
  const img = event.currentTarget;
  if (
    img.src.includes("maxresdefault") &&
    img.naturalWidth > 0 &&
    img.naturalWidth < YOUTUBE_MAXRES_MIN_WIDTH
  ) {
    applyYoutubeThumbnailHqFallback(img, videoId);
  }
}

/** Props for clip-card <img> thumbnails (maxres → hq on error or tiny placeholder). */
export function youtubeThumbnailImgProps(videoId: string) {
  return {
    src: youtubeThumbnailUrl(videoId, "max"),
    onError: (e: { currentTarget: HTMLImageElement }) => onYoutubeThumbnailError(e, videoId),
    onLoad: (e: { currentTarget: HTMLImageElement }) => onYoutubeThumbnailLoad(e, videoId),
  };
}

export type ClipModalPlayback = {
  embedUrl: string;
  originalYouTubeUrl: string;
  title: string;
  channel: string;
  rangeLabel: string;
};

export function buildClipModalPlayback(selectedClip: Record<string, any> | null): ClipModalPlayback | null {
  if (!selectedClip) return null;
  const moments = Array.isArray(selectedClip?.moments) ? selectedClip.moments : null;
  const primary = moments && moments.length > 0 ? (moments[0] as Record<string, unknown>) : null;
  const clipUrl = selectedClip.videoUrl || selectedClip.url;
  const videoId =
    selectedClip.videoId || extractVideoId(typeof clipUrl === "string" ? clipUrl : "");
  if (!videoId) return null;
  const startSeconds = Math.max(
    0,
    Math.floor(toSeconds(String(primary?.startTime ?? selectedClip.startTime ?? 0))),
  );
  const endSeconds = Math.max(
    0,
    Math.floor(toSeconds(String(primary?.endTime ?? selectedClip.endTime ?? 0))),
  );
  const hasEnd = endSeconds > startSeconds && endSeconds > 0;
  let embedUrl = `https://www.youtube.com/embed/${videoId}?start=${startSeconds}&autoplay=1`;
  if (hasEnd) embedUrl += `&end=${endSeconds}`;
  embedUrl += "&rel=0&iv_load_policy=3";
  const rangeLabel = hasEnd
    ? `${formatTimestamp(startSeconds)} – ${formatTimestamp(endSeconds)}`
    : formatTimestamp(startSeconds);
  const originalYouTubeUrl = `https://www.youtube.com/watch?v=${videoId}&t=${startSeconds}s`;
  return {
    embedUrl,
    originalYouTubeUrl,
    title: selectedClip.title || "Untitled clip",
    channel: selectedClip.channelName || selectedClip.channel || "Unknown channel",
    rangeLabel,
  };
}
