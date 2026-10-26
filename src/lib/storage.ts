/** Small typed wrappers over localStorage. Reads never throw (private windows, full storage). */
export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the app still works, it just forgets on reload.
  }
}

export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignored, as above
  }
}

export const keys = {
  putioToken: "pc.putio.token",
  chillToken: "pc.chill.token",
  library: "pc.library.v1",
  matches: "pc.matches.v1",
  /** Fix Match choices (matchOverrides.ts). */
  matchOverrides: "pc.matchOverrides.v1",
  durations: "pc.durations.v1",
  positions: "pc.positions.v1",
  /** When each file was watched (lib/watched.ts). */
  watched: "pc.watched.v1",
  settings: "pc.settings.v1",
  myList: "pc.mylist.v1",
  recentSearches: "pc.search.recent.v1",
} as const;
