/** Trakt: IMDb's Top 250 charts (from Trakt's long-running public mirror lists, since IMDb blocks direct access) and
 * last weekend's US box office. Trakt allows browser requests, so these go straight to api.trakt.tv. */
import type { MediaKind } from "../tmdb";
import type { ListTitle } from "./titles";

const BASE = "https://api.trakt.tv";
const CLIENT_ID = (import.meta.env.VITE_TRAKT_CLIENT_ID as string | undefined)?.trim();

export const hasTrakt = Boolean(CLIENT_ID);

export interface Chart {
  id: string;
  user: string;
  list: string;
  kind: MediaKind;
  title: string;
}

export const charts: Record<string, Chart> = {
  "top250-movie": { id: "top250-movie", user: "justin", list: "imdb-top-rated-movies", kind: "movie", title: "IMDb Top 250 Movies" },
  "top250-tv": { id: "top250-tv", user: "justin", list: "imdb-top-rated-tv-shows", kind: "tv", title: "IMDb Top 250 TV" },
};

export const chartFor = (kind: MediaKind) => charts[kind === "tv" ? "top250-tv" : "top250-movie"];

interface Media { title?: string; year?: number | null; ids?: { imdb?: string | null; tmdb?: number | null } }
interface Item { rank?: number; type?: string; movie?: Media; show?: Media }

async function get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  if (!CLIENT_ID) throw new Error("No Trakt client ID: set VITE_TRAKT_CLIENT_ID in .env.local.");
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const response = await fetch(url, { headers: { "trakt-api-key": CLIENT_ID, "trakt-api-version": "2", "Content-Type": "application/json" } });
  if (!response.ok) throw new Error(`Trakt ${response.status}`);
  return response.json() as Promise<T>;
}

function title(media: Media, kind: MediaKind, rank: number): ListTitle | undefined {
  if (!media.title) return undefined;
  return {
    kind, title: media.title, year: media.year ?? undefined, rank, source: "trakt",
    imdbID: media.ids?.imdb ?? undefined, tmdbID: media.ids?.tmdb ?? undefined,
  };
}

export function parseListItems(raw: Item[]): ListTitle[] {
  return raw.flatMap((item, index) => {
    const rank = item.rank ?? index + 1;
    const found = item.type === "movie" && item.movie ? title(item.movie, "movie", rank)
      : item.type === "show" && item.show ? title(item.show, "tv", rank) : undefined;
    return found ? [found] : [];
  });
}

/** A chart's entries in rank order. Trakt pages list items, so ask for 250 a page and follow pages until a short one. */
export async function chartTitles(chart: Chart, pageSize = 250, maxPages = 4): Promise<ListTitle[]> {
  const all: Item[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await get<Item[]>(`users/${chart.user}/lists/${chart.list}/items`, { page: String(page), limit: String(pageSize) });
    all.push(...batch);
    if (batch.length < pageSize) break;
  }
  return parseListItems(all);
}

export interface BoxOfficeEntry extends ListTitle {
  rank: number;
  /** Weekend gross in US dollars. */
  revenue?: number;
}

export function parseBoxOffice(raw: { revenue?: number | null; movie?: Media }[]): BoxOfficeEntry[] {
  return raw.flatMap((row, index) => {
    const t = row.movie && title(row.movie, "movie", index + 1);
    return t ? [{ ...t, rank: index + 1, revenue: row.revenue ?? undefined }] : [];
  });
}

/** Last weekend's US box office top 10. */
export async function boxOffice(): Promise<BoxOfficeEntry[]> {
  return parseBoxOffice(await get("movies/boxoffice"));
}

/** "$42.1M", "$850K". */
export function revenueText(revenue?: number): string | undefined {
  if (!revenue || revenue <= 0) return undefined;
  if (revenue >= 1_000_000) return `$${(revenue / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(revenue / 1_000)}K`;
}
