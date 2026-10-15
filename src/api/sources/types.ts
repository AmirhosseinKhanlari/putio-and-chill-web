/** What every torrent source returns, and what it is asked for (the iPhone app's Release, MediaQuery and
 * ReleaseRelevance). */
import type { ParsedRelease } from "../../lib/releaseName";

export type SourceID = "chill" | "yts" | "eztv" | "apibay" | "knaben" | "torrentscsv";

export interface Release {
  name: string;
  /** A magnet link (built from the info-hash where the source only gives a hash), or chill's own link. */
  link: string;
  /** Lowercase 40-character hex; the key that merges the same torrent found on several sources. */
  infoHash?: string;
  sizeBytes?: number;
  seeders?: number;
  /** Where it was found, e.g. "YTS", "TPB", "chill · 1337x". */
  sources: string[];
  parsed: ParsedRelease;
}

export type ReleaseQuery =
  | { kind: "movie"; title: string; year?: number; imdbID?: string }
  | { kind: "episode"; title: string; imdbID?: string; season: number; episode: number }
  | { kind: "season"; title: string; imdbID?: string; season: number }
  | { kind: "text"; text: string };

export interface SourceProvider {
  id: SourceID;
  releases(query: ReleaseQuery, signal?: AbortSignal): Promise<Release[]>;
}

const two = (n: number) => String(n).padStart(2, "0");

/** The words a free-text source is searched with ("Severance S02E04", "Dune Part Two 2024"). */
export function searchText(query: ReleaseQuery): string {
  switch (query.kind) {
    case "movie": return [query.title, query.year].filter(Boolean).join(" ");
    case "episode": return `${query.title} S${two(query.season)}E${two(query.episode)}`;
    case "season": return `${query.title} S${two(query.season)}`;
    case "text": return query.text;
  }
}

const normTitle = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/** Keeps the free-text hits that are what was asked for: that episode (or a multi-episode file holding it), that
 * season's pack, or that movie within a year. Movies also need the same title, so a search for "Dune 2021" can't
 * pick a documentary about it (the iPhone app checks the year only). */
export function matchesQuery(p: ParsedRelease, query: ReleaseQuery): boolean {
  switch (query.kind) {
    case "episode": {
      if (p.season !== query.season || p.episode === undefined) return false;
      return p.episode === query.episode || (p.episodeEnd !== undefined && query.episode >= p.episode && query.episode <= p.episodeEnd);
    }
    case "season":
      return p.season === query.season && p.episode === undefined;
    case "movie":
      if (p.season !== undefined) return false;
      if (p.title && normTitle(p.title) !== normTitle(query.title)) return false;
      return query.year === undefined || p.year === undefined || Math.abs(p.year - query.year) <= 1;
    case "text":
      return true;
  }
}

/** Numbers that arrive as numbers or strings ("946"); nothing for empty values. */
export function lossyNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export class SourceError extends Error {
  constructor(readonly source: SourceID, message: string) {
    super(message);
  }
}

/** fetch + JSON with one readable error per source. */
export async function fetchJSON<T>(source: SourceID, url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new SourceError(source, "couldn't be reached");
  }
  if (!response.ok) throw new SourceError(source, `answered ${response.status}`);
  try {
    return (await response.json()) as T;
  } catch {
    throw new SourceError(source, "sent something unreadable");
  }
}
