/** TMDB, for artwork, details, episodes and search. */
const BASE = "https://api.themoviedb.org/3";
const TOKEN = import.meta.env.VITE_TMDB_TOKEN as string | undefined;

export type MediaKind = "movie" | "tv";

export interface CatalogItem {
  tmdbID: number;
  kind: MediaKind;
  title: string;
  year?: number;
  posterPath?: string | null;
  backdropPath?: string | null;
  overview?: string;
  rating?: number;
}

export interface Episode {
  number: number;
  name: string;
  overview?: string;
  stillPath?: string | null;
  runtimeMinutes?: number | null;
  airDate?: string | null;
  rating?: number;
}

export interface SeasonSummary {
  number: number;
  name: string;
  episodeCount: number;
}

export interface CastMember {
  id: number;
  name: string;
  role?: string;
  profilePath?: string | null;
}

export interface TitleDetail {
  item: CatalogItem;
  imdbID?: string;
  runtimeMinutes?: number;
  genres: string[];
  seasons: SeasonSummary[];
  cast: CastMember[];
  trailerKey?: string;
  recommendations: CatalogItem[];
  nextEpisode?: { season: number; episode: number; name: string; airDate?: string };
  numberOfSeasons?: number;
}

export const hasTMDB = Boolean(TOKEN);

export function image(path: string | null | undefined, size: "w185" | "w342" | "w500" | "w780" | "w1280" | "original" = "w342"): string | undefined {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
}

/** Any TMDB v3 endpoint (for the modules that add lists, people and so on). */
export async function tmdbGet<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  return get<T>(path, query);
}

async function get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  if (!TOKEN) throw new Error("No TMDB token: set VITE_TMDB_TOKEN in .env.local.");
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  return response.json() as Promise<T>;
}

export interface RawItem {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
}

const yearOf = (date?: string) => (date && date.length >= 4 ? Number(date.slice(0, 4)) : undefined);

function item(raw: RawItem, kind?: MediaKind): CatalogItem | undefined {
  const k = kind ?? (raw.media_type === "movie" || raw.media_type === "tv" ? raw.media_type : undefined);
  if (!k) return undefined;
  return {
    tmdbID: raw.id, kind: k, title: raw.title ?? raw.name ?? "",
    year: yearOf(raw.release_date ?? raw.first_air_date),
    posterPath: raw.poster_path, backdropPath: raw.backdrop_path, overview: raw.overview, rating: raw.vote_average,
  };
}

export const items = (raws: RawItem[], kind?: MediaKind) => raws.map((r) => item(r, kind)).filter((i): i is CatalogItem => Boolean(i));

export const tmdb = {
  async trending(kind: MediaKind | "all" = "all"): Promise<CatalogItem[]> {
    return items((await get<{ results: RawItem[] }>(`trending/${kind}/week`)).results, kind === "all" ? undefined : kind);
  },
  async list(kind: MediaKind, list: "popular" | "top_rated" | "now_playing" | "on_the_air" | "airing_today"): Promise<CatalogItem[]> {
    return items((await get<{ results: RawItem[] }>(`${kind}/${list}`)).results, kind);
  },
  async discover(kind: MediaKind, genre: number): Promise<CatalogItem[]> {
    return items((await get<{ results: RawItem[] }>(`discover/${kind}`, { with_genres: String(genre), sort_by: "popularity.desc" })).results, kind);
  },
  async search(query: string): Promise<CatalogItem[]> {
    return items((await get<{ results: RawItem[] }>("search/multi", { query, include_adult: "false" })).results);
  },
  async searchKind(kind: MediaKind, query: string, year?: number): Promise<CatalogItem[]> {
    const q: Record<string, string> = { query, include_adult: "false" };
    if (year && kind === "movie") q.year = String(year);
    return items((await get<{ results: RawItem[] }>(`search/${kind}`, q)).results, kind);
  },
  async detail(kind: MediaKind, id: number): Promise<TitleDetail> {
    const raw = await get<RawItem & {
      runtime?: number; episode_run_time?: number[]; genres?: { name: string }[];
      seasons?: { season_number: number; name: string; episode_count: number }[];
      external_ids?: { imdb_id?: string };
      credits?: { cast?: { id: number; name: string; character?: string; profile_path?: string | null }[]; crew?: { id: number; name: string; job?: string; profile_path?: string | null }[] };
      videos?: { results?: { key: string; site: string; type: string }[] };
      recommendations?: { results: RawItem[] };
      next_episode_to_air?: { season_number: number; episode_number: number; name: string; air_date?: string } | null;
      number_of_seasons?: number;
    }>(`${kind}/${id}`, { append_to_response: "credits,videos,external_ids,recommendations" });
    const directors = (raw.credits?.crew ?? []).filter((c) => c.job === "Director" || c.job === "Creator").slice(0, 2);
    return {
      item: item(raw, kind)!,
      imdbID: raw.external_ids?.imdb_id ?? undefined,
      runtimeMinutes: raw.runtime ?? raw.episode_run_time?.[0],
      genres: (raw.genres ?? []).map((g) => g.name),
      seasons: (raw.seasons ?? []).filter((s) => s.season_number > 0).map((s) => ({ number: s.season_number, name: s.name, episodeCount: s.episode_count })),
      cast: [
        ...(raw.credits?.cast ?? []).slice(0, 14).map((c) => ({ id: c.id, name: c.name, role: c.character, profilePath: c.profile_path })),
        ...directors.map((c) => ({ id: c.id, name: c.name, role: c.job, profilePath: c.profile_path })),
      ],
      trailerKey: raw.videos?.results?.find((v) => v.site === "YouTube" && v.type === "Trailer")?.key,
      recommendations: items(raw.recommendations?.results ?? [], kind).slice(0, 20),
      nextEpisode: raw.next_episode_to_air
        ? { season: raw.next_episode_to_air.season_number, episode: raw.next_episode_to_air.episode_number, name: raw.next_episode_to_air.name, airDate: raw.next_episode_to_air.air_date }
        : undefined,
      numberOfSeasons: raw.number_of_seasons,
    };
  },
  /** How many seasons a show has; undefined when TMDB doesn't say. */
  async seasonCount(id: number): Promise<number | undefined> {
    return (await get<{ number_of_seasons?: number }>(`tv/${id}`)).number_of_seasons ?? undefined;
  },
  async season(id: number, season: number): Promise<Episode[]> {
    const raw = await get<{ episodes: { episode_number: number; name: string; overview?: string; still_path?: string | null; runtime?: number | null; air_date?: string | null; vote_average?: number }[] }>(`tv/${id}/season/${season}`);
    return raw.episodes.map((e) => ({
      number: e.episode_number, name: e.name, overview: e.overview, stillPath: e.still_path,
      runtimeMinutes: e.runtime, airDate: e.air_date, rating: e.vote_average,
    }));
  },
};
