/** Next Episode timing, as in the iPhone app's NextUp.swift. */
import { creditsLength } from "../../lib/watched";

// Where the credits start is also where a video can count as watched (lib/watched.ts).
export { creditsLength };

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
