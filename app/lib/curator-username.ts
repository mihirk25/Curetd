/** Normalize a public handle for profile URLs and @mentions. */
export function normalizeCuratorUsername(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

type LiveUsernameEntry =
  | string
  | null
  | undefined
  | { username?: string | null | undefined };

/**
 * Prefer the live `users/{userId}.username` over denormalized `clip.username`.
 * After a rename, clip/collection docs keep the old handle until rewritten; if that
 * handle is reclaimed, trusting the denormalized field misattributes the clip.
 *
 * When `liveByUid` has an entry for `userId` (including null), that value wins.
 * Denormalized username is only used when no live lookup result is available yet.
 */
export function resolveCuratorHandle(
  entity: { username?: unknown; userId?: unknown },
  liveByUid?: Record<string, LiveUsernameEntry> | null,
): string | null {
  const uid = typeof entity.userId === "string" && entity.userId ? entity.userId : null;
  if (uid && liveByUid && Object.prototype.hasOwnProperty.call(liveByUid, uid)) {
    const entry = liveByUid[uid];
    if (typeof entry === "string" || entry == null) {
      return normalizeCuratorUsername(entry);
    }
    return normalizeCuratorUsername(entry.username);
  }
  return normalizeCuratorUsername(entity.username);
}
