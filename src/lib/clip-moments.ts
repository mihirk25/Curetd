/**
 * Legacy Curate/DM clips (and post-deleteMoment phantoms) store the visible
 * range on top-level startTime/endTime with an empty or missing moments[].
 * Merge/append paths must materialize that range before writing moments, or
 * getMoments() will hide it forever once moments becomes non-empty.
 */
export type ClipMomentLike = {
  id: string;
  startTime: number;
  endTime: number;
  note: string;
  topic: string;
  addedAt: unknown;
};

export type ClipMomentsSource = {
  id?: string;
  moments?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  note?: unknown;
  topic?: unknown;
  createdAt?: unknown;
};

function asFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** True when moments is missing or an empty array. */
export function hasEmptyMoments(data: ClipMomentsSource | null | undefined): boolean {
  return !Array.isArray(data?.moments) || data.moments.length === 0;
}

/**
 * Build the synthetic moment the UI shows via getMoments() when moments is empty.
 * Returns null when there is no meaningful top-level range to preserve.
 */
export function legacyMomentFromTopLevel(
  data: ClipMomentsSource | null | undefined,
): ClipMomentLike | null {
  if (!data) return null;
  const startTime = asFiniteNumber(data.startTime, NaN);
  const endTime = asFiniteNumber(data.endTime, NaN);
  // Require at least one real bound so we don't invent a 0–0 moment.
  if (!Number.isFinite(startTime) && !Number.isFinite(endTime)) return null;
  const st = Number.isFinite(startTime) ? startTime : 0;
  const et = Number.isFinite(endTime) ? endTime : st;
  return {
    id: data.id ? `${data.id}_legacy` : "legacy",
    startTime: st,
    endTime: et,
    note: typeof data.note === "string" ? data.note : "",
    topic: typeof data.topic === "string" ? data.topic : "",
    addedAt: data.createdAt ?? null,
  };
}

/**
 * Moments to keep when appending a new moment onto an existing clip doc.
 * Preserves stored moments[], or materializes the legacy top-level range.
 */
export function momentsBeforeAppend(
  data: ClipMomentsSource | null | undefined,
): ClipMomentLike[] {
  if (Array.isArray(data?.moments) && data.moments.length > 0) {
    return data.moments as ClipMomentLike[];
  }
  const legacy = legacyMomentFromTopLevel(data);
  return legacy ? [legacy] : [];
}
