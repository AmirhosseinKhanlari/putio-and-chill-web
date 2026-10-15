/** Next Episode timing, as in the iPhone app's NextUp.swift. */

/** Seconds before the end at which the credits are assumed to start: 2.5% of the running time, 20–60 s
 * (about 33 s for a half-hour show, a minute for an hour-long one). */
export function creditsLength(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(60, Math.max(20, duration * 0.025));
}

/** How long the Next Episode button counts down before playing by itself. */
export const COUNTDOWN_SECONDS = 8;

export type NextUpCardState = "hidden" | "credits" | "end";

/** The card shows when the credits start (or at the end after Watch Credits), and hides if you seek back. */
export function nextUpCardState(position: number, duration: number, ended: boolean, creditsDismissed: boolean): NextUpCardState {
  if (!Number.isFinite(duration) || duration <= 0) return "hidden";
  const remaining = duration - position;
  if (ended || remaining < 1.5) return "end";
  if (remaining <= creditsLength(duration)) return creditsDismissed ? "hidden" : "credits";
  return "hidden";
}
