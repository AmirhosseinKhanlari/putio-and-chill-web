/** Titles from lists outside TMDB (Trakt, chill.institute, MyMoviz, IMDb) and how they become TMDB items: by TMDB id,
 * else IMDb id, else title and year. Each title is looked up once; matches are kept in this browser. */
import { items, tmdbGet, type CatalogItem, type MediaKind, type RawItem } from "../tmdb";
import { readJSON, writeJSON } from "../../lib/storage";

export interface ListTitle {
  kind: MediaKind;
  title: string;
  year?: number;
  imdbID?: string;
  tmdbID?: number;
  /** YYYY-MM-DD when the list knows it. */
  releaseDate?: string;
  /** Position in a ranked chart. */
  rank?: number;
  source: string;
}

/** Same title across lists: IMDb id when there is one, else title and year. */
export const mergeKey = (t: Pick<ListTitle, "imdbID" | "title" | "year">) => t.imdbID ?? `${t.title.toLowerCase()}|${t.year ?? 0}`;

/** A title with only a year counts as late that year, so lists without exact dates mix in by year instead of always
 * sinking below dated ones. */
function sortDate(t: ListTitle): string | undefined {
  if (t.releaseDate) return t.releaseDate;
  return t.year ? `${t.year}-12-31` : undefined;
}

/** Several lists as one (port of ChillMerge.combine): round-robin so each list's top picks come before any list's
 * tail, duplicates dropped (first wins), then newest first with undated titles after, in list order. */
export function combine(lists: ListTitle[][]): ListTitle[] {
  const seen = new Set<string>();
  const merged: ListTitle[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const t = list[i];
      if (!t) continue;
      const key = mergeKey(t);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }
  }
  return merged
    .map((t, offset) => ({ t, offset, date: sortDate(t) }))
    .sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return a.date > b.date ? -1 : 1;
      if (!a.date && b.date) return 1;
      if (a.date && !b.date) return -1;
      return a.offset - b.offset;
    })
    .map((x) => x.t);
}

/** "tt1234567" from an id, a link or any text. */
export function imdbIDIn(...values: (string | undefined | null)[]): string | undefined {
  for (const v of values) {
    const m = v ? /tt\d{5,}/.exec(v) : null;
    if (m) return m[0];
  }
  return undefined;
}

/** "Unit 23 Reloaded 2024" → ["Unit 23 Reloaded", 2024]. */
export function splitYear(label: string): [string, number | undefined] {
  const m = /\s((?:19|20)\d{2})$/.exec(label);
  return m ? [label.slice(0, m.index), Number(m[1])] : [label, undefined];
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// MARK: Matching to TMDB

const MATCHES_KEY = "pc.lists.matches.v1";
const MAX_MATCHES = 4000;
/** key → TMDB item, or null when TMDB has nothing for it (a failed request is never remembered). */
const matches = new Map<string, CatalogItem | null>(Object.entries(readJSON<Record<string, CatalogItem | null>>(MATCHES_KEY, {})));
const inFlight = new Map<string, Promise<CatalogItem | undefined>>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function remember(key: string, value: CatalogItem | null) {
  matches.delete(key);
  matches.set(key, value);
  // Oldest first in a Map: drop from the front to stay bounded.
  while (matches.size > MAX_MATCHES) matches.delete(matches.keys().next().value as string);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJSON(MATCHES_KEY, Object.fromEntries(matches)), 800);
}

const matchKey = (t: ListTitle) => (t.tmdbID ? `${t.kind}:tmdb:${t.tmdbID}` : `${t.kind}:${mergeKey(t)}`);

/** The match this browser already knows, without asking TMDB. */
export function knownMatch(t: ListTitle): CatalogItem | null | undefined {
  return matches.get(matchKey(t));
}

async function lookup(t: ListTitle): Promise<CatalogItem | null> {
  if (t.tmdbID) {
    const raw = await tmdbGet<RawItem>(`${t.kind}/${t.tmdbID}`);
    return items([raw], t.kind)[0] ?? null;
  }
  let otherKind: CatalogItem | undefined;
  if (t.imdbID) {
    const found = await tmdbGet<{ movie_results?: RawItem[]; tv_results?: RawItem[] }>(`find/${t.imdbID}`, { external_source: "imdb_id" });
    const movie = items(found.movie_results ?? [], "movie")[0];
    const show = items(found.tv_results ?? [], "tv")[0];
    const same = t.kind === "movie" ? movie : show;
    if (same) return same;
    otherKind = t.kind === "movie" ? show : movie;
  }
  // Not on TMDB under that IMDb id in this kind: by title and year, then whatever the IMDb id found.
  const query: Record<string, string> = { query: t.title, include_adult: "false" };
  if (t.year) query[t.kind === "tv" ? "first_air_date_year" : "year"] = String(t.year);
  const searched = items((await tmdbGet<{ results: RawItem[] }>(`search/${t.kind}`, query)).results, t.kind)[0];
  return searched ?? otherKind ?? null;
}

/** The TMDB item for a list title; undefined when there is none or TMDB couldn't be reached. */
export function resolveTitle(t: ListTitle): Promise<CatalogItem | undefined> {
  const key = matchKey(t);
  const known = matches.get(key);
  if (known !== undefined) return Promise.resolve(known ?? undefined);
  let pending = inFlight.get(key);
  if (!pending) {
    pending = lookup(t)
      .then((found) => { remember(key, found); return found ?? undefined; })
      .catch(() => undefined)
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/** TMDB items for titles, in list order (six lookups at a time); unmatched titles dropped, each title once. */
export async function resolveTitles(titles: ListTitle[], concurrency = 6): Promise<CatalogItem[]> {
  const found: (CatalogItem | undefined)[] = new Array(titles.length);
  let next = 0;
  const worker = async () => {
    while (next < titles.length) {
      const index = next++;
      found[index] = await resolveTitle(titles[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, titles.length) }, worker));
  return uniqueItems(found.filter((i): i is CatalogItem => Boolean(i)));
}

export function uniqueItems(list: CatalogItem[]): CatalogItem[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const key = `${i.kind}-${i.tmdbID}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Runs `task` over `values`, `concurrency` at a time, keeping order; failures become undefined. */
export async function mapLimited<T, R>(values: T[], concurrency: number, task: (value: T) => Promise<R>): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next++;
      out[index] = await task(values[index]).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return out;
}
