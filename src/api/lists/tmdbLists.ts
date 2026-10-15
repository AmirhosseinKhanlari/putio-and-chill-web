/** TMDB lists for Home, Movies, TV, Coming Up and their "See all" pages: the iPhone app's themed lists (New on
 * Netflix, New Series, Returning This Week, …), genres, charts by page, and dated releases. */
import { items, tmdbGet, type CatalogItem, type MediaKind, type RawItem } from "../tmdb";

export interface Genre { id: number; name: string }

/** The genre rows, in the iPhone app's order. */
export const genres: Record<MediaKind, Genre[]> = {
  movie: [
    { id: 28, name: "Action" }, { id: 35, name: "Comedy" }, { id: 18, name: "Drama" }, { id: 878, name: "Science Fiction" },
    { id: 53, name: "Thriller" }, { id: 27, name: "Horror" }, { id: 16, name: "Animation" }, { id: 99, name: "Documentary" },
  ],
  tv: [
    { id: 18, name: "Drama" }, { id: 35, name: "Comedy" }, { id: 80, name: "Crime" }, { id: 10765, name: "Sci-Fi & Fantasy" },
    { id: 9648, name: "Mystery" }, { id: 16, name: "Animation" }, { id: 99, name: "Documentary" }, { id: 10764, name: "Reality" },
  ],
};

export type Curated = "netflix" | "disney" | "new-series" | "returning" | "acclaimed";

export const curatedTitles: Record<Curated, string> = {
  netflix: "New on Netflix",
  disney: "New on Disney+",
  "new-series": "New Series",
  returning: "Returning This Week",
  acclaimed: "Critically Acclaimed",
};

/** In the iPhone app's order; New Series and Returning This Week are about shows only. */
export const curatedFor = (kind: MediaKind): Curated[] =>
  kind === "tv" ? ["netflix", "disney", "new-series", "returning", "acclaimed"] : ["netflix", "disney", "acclaimed"];

/** Talk, News, Reality and Soap: daily shows that would crowd out series in the TV lists. */
export const notSeries = "10767|10763|10764|10766";

/** YYYY-MM-DD in UTC, `plus` days from `date` (what TMDB's date filters compare against). */
export function utcDay(date: Date, plus = 0): string {
  return new Date(date.getTime() + plus * 86_400_000).toISOString().slice(0, 10);
}

/** TMDB /discover filters for a themed list. Streaming lists use the US catalog. */
export function curatedQuery(list: Curated, kind: MediaKind, today: Date, region = "US"): Record<string, string> {
  const day = (offset: number) => utcDay(today, offset);
  const after = kind === "tv" ? "first_air_date.gte" : "primary_release_date.gte";
  const before = kind === "tv" ? "first_air_date.lte" : "primary_release_date.lte";
  const q: Record<string, string> = { sort_by: "popularity.desc" };
  switch (list) {
    case "netflix":
    case "disney":
      if (kind === "tv") {
        // The service's own shows with episodes out in the last month: new shows and new seasons. (By watch provider
        // this would be network reruns that also stream there.)
        q.with_networks = list === "netflix" ? "213" : "2739";
        q["air_date.gte"] = day(-30);
        q["air_date.lte"] = day(0);
        q.without_genres = notSeries;
      } else {
        q.with_watch_providers = list === "netflix" ? "8" : "337";
        q.watch_region = region;
        q.with_watch_monetization_types = "flatrate";
        q[after] = day(-120);
        q[before] = day(0);
      }
      break;
    case "new-series":
      q[after] = day(-60);
      q[before] = day(0);
      q["vote_count.gte"] = "5";
      q.without_genres = notSeries;
      break;
    case "returning":
      // Episodes airing in the next seven days of shows that premiered over three months ago.
      q["air_date.gte"] = day(0);
      q["air_date.lte"] = day(7);
      q[before] = day(-90);
      q.without_genres = notSeries;
      q["vote_count.gte"] = "50";
      break;
    case "acclaimed":
      // Highly rated with plenty of votes, from the last five years (Top Rated covers all time).
      q.sort_by = "vote_average.desc";
      q["vote_average.gte"] = kind === "tv" ? "8.0" : "7.5";
      q["vote_count.gte"] = kind === "tv" ? "300" : "1000";
      q[after] = day(-5 * 365);
      break;
  }
  return q;
}

/** One TMDB list, by the id used in /list/tmdb/:id. */
export interface TmdbListSpec {
  id: string;
  title: string;
  /** Unset for mixed lists (Trending). */
  kind?: MediaKind;
  path: string;
  query: Record<string, string>;
  /** Titles carry a release or premiere date worth showing. */
  dated?: boolean;
}

export const tmdbListID = {
  popular: (kind: MediaKind) => `${kind}-popular`,
  topRated: (kind: MediaKind) => `${kind}-top_rated`,
  trending: (kind: MediaKind | "all") => `trending-${kind}`,
  genre: (kind: MediaKind, id: number) => `${kind}-genre-${id}`,
  curated: (kind: MediaKind, list: Curated) => `${kind}-${list}`,
  recommendations: (kind: MediaKind, id: number) => `${kind}-like-${id}`,
  nowPlaying: "movie-now_playing",
  upcomingMovies: "movie-upcoming",
  premieres: "tv-premieres",
};

/** What a /list/tmdb/:id address stands for; undefined for an unknown id. */
export function tmdbListSpec(id: string, today = new Date()): TmdbListSpec | undefined {
  const trending = /^trending-(all|movie|tv)$/.exec(id);
  if (trending) {
    const kind = trending[1] === "all" ? undefined : (trending[1] as MediaKind);
    return { id, kind, title: kind === "tv" ? "Trending Shows" : kind === "movie" ? "Trending Movies" : "Trending Now", path: `trending/${trending[1]}/week`, query: {} };
  }
  const m = /^(movie|tv)-(.+)$/.exec(id);
  if (!m) return undefined;
  const kind = m[1] as MediaKind;
  const rest = m[2];
  const noun = kind === "tv" ? "TV" : "Movies";
  if (rest === "popular") return { id, kind, title: `Popular ${noun}`, path: `${kind}/popular`, query: {} };
  if (rest === "top_rated") return { id, kind, title: `Top Rated ${noun}`, path: `${kind}/top_rated`, query: {} };
  if (rest === "now_playing" && kind === "movie") return { id, kind, title: "In Cinemas Now", path: "movie/now_playing", query: { region: "US" } };
  if (rest === "upcoming" && kind === "movie") return { id, kind, title: "Coming Soon to Cinemas", path: "movie/upcoming", query: { region: "US" }, dated: true };
  if (rest === "premieres" && kind === "tv") return { id, kind, title: "Premiering Soon", path: "discover/tv", query: premieresQuery(today), dated: true };
  const genre = /^genre-(\d+)$/.exec(rest);
  if (genre) {
    const g = genres[kind].find((x) => x.id === Number(genre[1]));
    return { id, kind, title: g ? `${g.name} ${kind === "tv" ? "Shows" : "Movies"}` : noun, path: `discover/${kind}`, query: { with_genres: genre[1], sort_by: "popularity.desc" } };
  }
  const like = /^like-(\d+)$/.exec(rest);
  if (like) return { id, kind, title: "More Like This", path: `${kind}/${like[1]}/recommendations`, query: {} };
  if (rest in curatedTitles && curatedFor(kind).includes(rest as Curated)) {
    const list = rest as Curated;
    return { id, kind, title: curatedTitles[list], path: `discover/${kind}`, query: { include_adult: "false", ...curatedQuery(list, kind, today) } };
  }
  return undefined;
}

export interface DatedItem { item: CatalogItem; date?: string }

export interface TmdbPage {
  items: CatalogItem[];
  dated: DatedItem[];
  page: number;
  totalPages: number;
}

/** One page of a list; TMDB serves at most 500 pages of 20. */
export async function tmdbListPage(spec: TmdbListSpec, page = 1): Promise<TmdbPage> {
  const raw = await tmdbGet<{ page?: number; total_pages?: number; results: RawItem[] }>(spec.path, { ...spec.query, page: String(page) });
  const dated = raw.results.flatMap((r) => {
    const item = items([r], spec.kind)[0];
    return item ? [{ item, date: r.release_date || r.first_air_date || undefined }] : [];
  });
  return { items: dated.map((d) => d.item), dated, page: raw.page ?? page, totalPages: Math.min(500, raw.total_pages ?? page) };
}

/** Shows premiering in the next 30 days. */
export function premieresQuery(today: Date): Record<string, string> {
  return {
    include_adult: "false", sort_by: "popularity.desc", "first_air_date.gte": utcDay(today), "first_air_date.lte": utcDay(today, 30),
    without_genres: notSeries,
  };
}

// MARK: Coming Up

export interface UpcomingEpisode {
  show: CatalogItem;
  season: number;
  episode: number;
  name: string;
  airDate: string;
  stillPath?: string | null;
}

/** Shows in put.io and on My List, put.io first, each once. */
export function yourShows(libraryShows: (number | undefined)[], myListShows: number[]): number[] {
  return [...new Set([...libraryShows.filter((id): id is number => id !== undefined), ...myListShows])];
}

/** The show's next episode when one is scheduled. */
export async function nextEpisode(tvID: number): Promise<UpcomingEpisode | undefined> {
  const raw = await tmdbGet<RawItem & { next_episode_to_air?: { air_date?: string; season_number?: number; episode_number?: number; name?: string; still_path?: string | null } | null }>(`tv/${tvID}`);
  const next = raw.next_episode_to_air;
  const show = items([raw], "tv")[0];
  if (!show || !next?.air_date || next.season_number === undefined || next.episode_number === undefined) return undefined;
  return { show, season: next.season_number, episode: next.episode_number, name: next.name || `Episode ${next.episode_number}`, airDate: next.air_date, stillPath: next.still_path };
}

/** YYYY-MM-DD in this browser's time zone (what "today" means to the person looking). */
export function localDay(date: Date, plus = 0): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + plus);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Future dates only (today too when inclusive), soonest first; undated titles dropped. */
export function upcomingOnly(list: DatedItem[], today: string, inclusive = false): DatedItem[] {
  return list.filter((d) => d.date && (inclusive ? d.date >= today : d.date > today))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

const fromDay = (date: string) => new Date(`${date}T12:00:00`);

/** Today, Tomorrow, the weekday within a week, then "Oct 24". */
export function dayLabel(date: string, today: Date): string {
  if (date === localDay(today)) return "Today";
  if (date === localDay(today, 1)) return "Tomorrow";
  const withinWeek = [2, 3, 4, 5, 6].some((n) => localDay(today, n) === date);
  return fromDay(date).toLocaleDateString("en-US", withinWeek ? { weekday: "long" } : { month: "short", day: "numeric" });
}

/** "Oct 24" for a release date. */
export function shortDate(date?: string): string | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return fromDay(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export interface EpisodeDay { date: string; label: string; episodes: UpcomingEpisode[] }

/** Episodes from today to 30 days out, grouped by day, shows A–Z within a day. */
export function groupByDay(episodes: UpcomingEpisode[], today: Date): EpisodeDay[] {
  const first = localDay(today), last = localDay(today, 30);
  const upcoming = episodes.filter((e) => e.airDate >= first && e.airDate <= last);
  const dates = [...new Set(upcoming.map((e) => e.airDate))].sort();
  return dates.map((date) => ({
    date, label: dayLabel(date, today),
    episodes: upcoming.filter((e) => e.airDate === date).sort((a, b) => a.show.title.localeCompare(b.show.title)),
  }));
}
