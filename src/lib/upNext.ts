/** Up Next: the episode after the one just finished, for Continue Watching and a show's Play button. The next
 * number in the same season, else the next season's first; from TMDB's seasons, plus the library's own files (so
 * it still works when TMDB fails or lags behind). Only an episode that has aired is offered. */
import type { Episode } from "../api/tmdb";
import type { LibraryEntry } from "./library";

export interface UpNext {
  season: number;
  episode: number;
  /** TMDB's name for it, when known. */
  name?: string;
  /** Its file in put.io; undefined when it isn't there yet. */
  entry?: LibraryEntry;
}

/** A season's episodes from TMDB: null when TMDB couldn't say (failed, or no such season), undefined while loading. */
export type SeasonLookup = (season: number) => Episode[] | null | undefined;

export type UpNextResult = { next: UpNext | undefined } | { loading: number };

interface Candidate { episode: number; name?: string; airDate?: string | null; entry?: LibraryEntry }

/** TMDB's episodes of a season joined with the show's files in it, by episode number. */
function candidates(season: number, fromTMDB: Episode[], files: LibraryEntry[]): Candidate[] {
  const byNumber = new Map<number, Candidate>();
  for (const e of fromTMDB) byNumber.set(e.number, { episode: e.number, name: e.name || undefined, airDate: e.airDate });
  for (const f of files) {
    const n = f.match?.season === season ? f.match.episode : undefined;
    if (n === undefined) continue;
    const known = byNumber.get(n);
    if (!known?.entry) byNumber.set(n, { ...known, episode: n, entry: f });
  }
  return [...byNumber.values()].sort((a, b) => a.episode - b.episode);
}

/** `files`: the show's files in put.io. `today`: "YYYY-MM-DD". Specials (season 0) never come up. */
export function upNextAfter(finished: { season: number; episode: number }, files: LibraryEntry[], seasons: SeasonLookup, today: string): UpNextResult {
  if (finished.season < 1) return { next: undefined };
  for (const [season, after] of [[finished.season, finished.episode], [finished.season + 1, 0]] as const) {
    const fromTMDB = seasons(season);
    if (fromTMDB === undefined) return { loading: season };
    const found = candidates(season, fromTMDB ?? [], files).find((c) => c.episode > after);
    if (!found) continue;
    // A file in put.io has obviously aired; otherwise TMDB has to say so.
    const aired = Boolean(found.entry) || Boolean(found.airDate && found.airDate <= today);
    return { next: aired ? { season, episode: found.episode, name: found.name, entry: found.entry } : undefined };
  }
  return { next: undefined };
}

/** "Up Next · S2 E5 · Name", or "· Not in put.io" when it has to be got first. */
export function upNextLabel(next: UpNext): string {
  const code = `Up Next · S${next.season} E${next.episode}`;
  if (!next.entry) return `${code} · Not in put.io`;
  return next.name ? `${code} · ${next.name}` : code;
}
