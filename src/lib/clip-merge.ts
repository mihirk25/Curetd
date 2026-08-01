/**
 * Treat missing `audioOnly` as false (legacy Curate / older saves).
 * Video-mode merges must find those docs; audio-only merges must not.
 */
export function clipMatchesAudioOnlyMode(
  data: { audioOnly?: unknown } | null | undefined,
  audioOnly: boolean,
): boolean {
  const isAudioOnly = data?.audioOnly === true;
  return isAudioOnly === Boolean(audioOnly);
}
