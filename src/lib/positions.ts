/** Watch positions: one record per file, merged so the newest value wins. The rules match the native apps exactly,
 * so every device settles on the same position. put.io's start-from is the shared copy; a save made here stays
 * pending until put.io has it. */
export interface Position {
  seconds: number;
  /** When this value was known to be true (ms since 1970). */
  at: number;
  source: "device" | "putio";
  /** When it was last watched anywhere, for Continue Watching's order; undefined when unknown. */
  watchedAt?: number;
  /** Saved here; put.io doesn't have it yet. */
  pending: boolean;
}

/** A position saved on this device just now. */
export const deviceSave = (seconds: number, at: number): Position => ({ seconds, at, source: "device", watchedAt: at, pending: true });

/** A position read from put.io; `at` is when the read started. */
export const putioRead = (seconds: number, at: number, watchedAt?: number): Position => ({ seconds, at, source: "putio", watchedAt, pending: false });

const latest = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));

export function mergePosition(current: Position | undefined, incoming: Position): Position {
  if (!current) return incoming;
  if (incoming.source === "device") return { ...incoming, watchedAt: incoming.at };
  // put.io has what we have: it's confirmed.
  if (incoming.seconds === current.seconds) return { ...current, pending: false, at: Math.max(current.at, incoming.at) };
  // put.io hasn't got our newer value yet, or we saved after the read began.
  if (current.pending || current.at >= incoming.at) return current;
  return { ...incoming, watchedAt: latest(current.watchedAt, incoming.watchedAt) };
}

export const samePosition = (a: Position | undefined, b: Position) =>
  a !== undefined && a.seconds === b.seconds && a.at === b.at && a.source === b.source && a.watchedAt === b.watchedAt && a.pending === b.pending;
