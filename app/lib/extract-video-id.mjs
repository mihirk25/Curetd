/** Parse a YouTube video id from watch, share, live, shorts, embed, and youtu.be URLs. */

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function hostIsYouTube(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  return host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com") || host.endsWith(".youtu.be");
}

function idFromPathSegment(segment) {
  const raw = String(segment || "").split(/[/?#]/)[0];
  return YT_ID_RE.test(raw) ? raw : null;
}

function idFromSearch(search) {
  try {
    const q = search.startsWith("?") ? search.slice(1) : search;
    const v = new URLSearchParams(q).get("v");
    return v && YT_ID_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function extractVideoId(url) {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;

  try {
    const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withScheme);
    if (hostIsYouTube(u.hostname)) {
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (host === "youtu.be" || host.endsWith(".youtu.be")) {
        const id = idFromPathSegment(u.pathname.split("/").filter(Boolean)[0]);
        if (id) return id;
      }
      const segments = u.pathname.split("/").filter(Boolean);
      const kind = segments[0];
      if (kind === "embed" || kind === "shorts" || kind === "live" || kind === "v") {
        const id = idFromPathSegment(segments[1]);
        if (id) return id;
      }
      const fromQuery = idFromSearch(u.search);
      if (fromQuery) return fromQuery;
    }
  } catch {
    // Fall through to regex fallbacks for non-URL paste.
  }

  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})(?:&|$|#)/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = trimmed.match(p);
    if (m) return m[1];
  }
  return null;
}
