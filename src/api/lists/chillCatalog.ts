/** chill.institute's catalog lists, with the user's chill token (port of the iPhone app's ChillCatalogClient).
 *
 * Movies come from chill's per-source RSS feeds, which don't touch the account. When a feed can't be read, this falls
 * back to the movie list chosen in the account's settings. (The iPhone app then saves each source in turn and puts
 * the user's choice back; a browser tab can close halfway through that, so the web app never changes the setting.)
 * chill allows browser requests, so all of this goes straight to api.chill.institute. */
import { parseReleaseName } from "../../lib/releaseName";
import { combine, decodeEntities, imdbIDIn, type ListTitle } from "./titles";

const ROOT = "https://api.chill.institute";

export const movieSources: [source: string, rssPath: string][] = [
  ["MOVIES_SOURCE_ROTTEN_TOMATOES", "rotten-tomatoes"],
  ["MOVIES_SOURCE_IMDB_MOVIEMETER", "imdb/moviemeter"],
  ["MOVIES_SOURCE_YTS", "yts"],
  ["MOVIES_SOURCE_TRAKT", "trakt"],
  ["MOVIES_SOURCE_IMDB_TOP_250", "imdb/top-250"],
];

const cdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

/** Each RSS (or Atom) item's title and any IMDb id in the item. Several releases of one movie collapse into one. */
export function parseChillRSS(xml: string, source: string): ListTitle[] {
  const seen = new Set<string>();
  const out: ListTitle[] = [];
  for (const match of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const body = match[2];
    const rawTitle = decodeEntities(cdata(/<title\b[^>]*>([\s\S]*?)<\/title>/.exec(body)?.[1] ?? "")).trim();
    if (!rawTitle) continue;
    const parsed = parseReleaseName(rawTitle);
    const name = (parsed.title || rawTitle).trim();
    if (!name) continue;
    const t: ListTitle = { kind: "movie", title: name, year: parsed.year, imdbID: imdbIDIn(cdata(body)), source };
    const key = t.imdbID ?? `${name.toLowerCase()}|${t.year ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

async function call<T>(token: string, method: string, body: unknown): Promise<T> {
  const response = await fetch(`${ROOT}/v4/chill.v4.UserService/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Connect-Protocol-Version": "1" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`chill.institute ${response.status}`);
  return response.json() as Promise<T>;
}

interface ChillMovie { id?: string; title?: string; titlePretty?: string; year?: number; externalUrl?: string; releaseDate?: string }
interface ChillShow { imdbId?: string; title?: string; year?: number; firstAirDate?: string; source?: string }

export const fromChillMovie = (m: ChillMovie, source: string): ListTitle => ({
  kind: "movie", title: m.titlePretty || m.title || "", year: m.year || undefined,
  imdbID: imdbIDIn(m.id, m.externalUrl), releaseDate: m.releaseDate || undefined, source,
});

export const fromChillShow = (s: ChillShow): ListTitle => ({
  kind: "tv", title: s.title ?? "", year: s.year || undefined, imdbID: imdbIDIn(s.imdbId),
  releaseDate: s.firstAirDate || undefined, source: s.source ?? "TV_SHOWS_SOURCE_ALL_PROVIDERS",
});

async function rssLists(token: string): Promise<ListTitle[][]> {
  return Promise.all(movieSources.map(async ([source, path]) => {
    const url = new URL(`${ROOT}/rss/movies/${path}`);
    url.searchParams.set("auth_token", token);
    const response = await fetch(url, { headers: { Accept: "application/rss+xml, application/xml, text/xml" } });
    if (!response.ok) throw new Error(`chill.institute RSS ${response.status}`);
    const titles = parseChillRSS(await response.text(), source);
    if (!titles.length) throw new Error("chill.institute RSS is empty");
    return titles;
  }));
}

/** Every movie list chill offers, merged, newest first. */
export async function chillMovies(token: string): Promise<ListTitle[]> {
  try {
    return combine(await rssLists(token));
  } catch {
    const r = await call<{ source?: string; movies?: ChillMovie[] }>(token, "GetMovies", {});
    return combine([(r.movies ?? []).map((m) => fromChillMovie(m, r.source ?? "chill")).filter((t) => t.title)]);
  }
}

/** chill's "All providers" TV list (already combined across streaming services), newest first. */
export async function chillShows(token: string): Promise<ListTitle[]> {
  const r = await call<{ shows?: ChillShow[] }>(token, "GetTVShows", { source: "TV_SHOWS_SOURCE_ALL_PROVIDERS" });
  return combine([(r.shows ?? []).map(fromChillShow).filter((t) => t.title)]);
}
