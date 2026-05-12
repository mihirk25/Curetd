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
