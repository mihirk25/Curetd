/** Normalize a public handle for profile URLs and @mentions. */
export function normalizeAuthorUsername(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

type LiveUsernameEntry =
  | string
  | null
  | undefined
  | { username?: string | null | undefined };

/**
 * Prefer the live `users/{userId}.username` over a denormalized `username` field.
 * After a rename, comment (and similar) docs keep the old handle until rewritten; if
 * that handle is reclaimed, trusting the denormalized field misattributes authorship.
 *
 * When `liveByUid` has an entry for `userId` (including null), that value wins.
 * Denormalized username is only used when no live lookup result is available yet.
 */
export function resolveAuthorHandle(
  entity: { username?: unknown; userId?: unknown } | Record<string, unknown>,
  liveByUid?: Record<string, LiveUsernameEntry> | null,
): string | null {
  const uid = typeof entity.userId === "string" && entity.userId ? entity.userId : null;
  if (uid && liveByUid && Object.prototype.hasOwnProperty.call(liveByUid, uid)) {
    const entry = liveByUid[uid];
    if (typeof entry === "string" || entry == null) {
      return normalizeAuthorUsername(entry);
    }
    return normalizeAuthorUsername(entry.username);
  }
  return normalizeAuthorUsername(entity.username);
}
