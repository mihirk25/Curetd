/**
 * True for browsers that can install Chrome extensions (Chromium-based).
 * Excludes Safari, Firefox, and other non-Chromium engines.
 */
export function supportsChromeExtensionBrowser(
  userAgent: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
): boolean {
  if (!userAgent) return false;

  if (/Firefox|FxiOS/i.test(userAgent)) return false;

  // Safari (incl. iOS) — WebKit without a Chromium engine token
  if (/Safari/i.test(userAgent) && !/Chrome|Chromium|Edg|OPR|CriOS|Brave/i.test(userAgent)) {
    return false;
  }

  return /Chrome|Chromium|Edg\/|OPR\/|CriOS|Brave/i.test(userAgent);
}
