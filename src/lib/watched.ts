/** When a video counts as watched, and how a position change moves its watched mark. The rules match the native
 * apps, so every device agrees on what's finished. A mark is when it was watched (ms since 1970). */
import type { Position } from "./positions";

/** A position this far in counts as started (Continue Watching, resume). */
export const STARTED_SECONDS = 30;

/** Seconds before the end at which the credits are assumed to start: 2.5% of the running time, 20–60 s
 * (about 33 s for a half-hour show, a minute for an hour-long one). */
export function creditsLength(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(60, Math.max(20, duration * 0.025));
}

/** Where a video becomes watched: 95% in, or the start of the credits if that comes first (short videos, where
 * 5% is less than the credits). */
export function watchedThreshold(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return Infinity;
  return Math.min(duration * 0.95, duration - creditsLength(duration));
}

export const reachedWatched = (position: number, duration: number | undefined) =>
  duration !== undefined && position >= watchedThreshold(duration);

/** The mark after `incoming` was merged into `previous` (giving `merged`). Newest wins: a started position saved
 * after the mark (a rewatch here, or one put.io reports from another device) takes it away; put.io's 0 never does
 * (that's the reset made on finishing). put.io's 0 replacing a started position means it was finished elsewhere. */
export function markAfter(mark: number | undefined, previous: Position | undefined, merged: Position, incoming: Position): number | undefined {
  // The merge kept what we had (an older read, or a save put.io hasn't got yet), or nothing moved.
  if (merged.seconds !== incoming.seconds || previous?.seconds === incoming.seconds) return mark;
  if (incoming.source === "device") return incoming.seconds >= STARTED_SECONDS ? undefined : mark;
  if (incoming.seconds >= STARTED_SECONDS) return mark !== undefined && incoming.at > mark ? undefined : mark;
  if (incoming.seconds === 0 && previous && previous.seconds >= STARTED_SECONDS) return incoming.at;
  return mark;
}
