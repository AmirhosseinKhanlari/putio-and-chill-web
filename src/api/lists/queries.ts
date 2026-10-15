/** react-query hooks for every list on Home, Movies, TV, Coming Up and the "See all" pages, so a row and its full page
 * share one cache. Lists change slowly: they stay fresh for hours, and the slow ones are kept in this browser so the
 * rows show at once on the next visit. */
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { keys, readJSON, readString, writeJSON } from "../../lib/storage";
import type { CatalogItem, MediaKind } from "../tmdb";
import { chillMovies, chillShows } from "./chillCatalog";
import { imdbListTitles, parseIMDbRef } from "./imdb";
import { myMovizLatest } from "./mymoviz";
import { combine, knownMatch, mapLimited, mergeKey, resolveTitle, resolveTitles, uniqueItems, type ListTitle } from "./titles";
import { tmdbListPage, tmdbListSpec, nextEpisode, utcDay } from "./tmdbLists";
import { boxOffice, chartTitles, charts, hasTrakt, type BoxOfficeEntry } from "./trakt";

const hour = 60 * 60_000;
const day = 24 * hour;

/** A query result kept in localStorage: shown at once, refetched when older than the query's staleTime. */
function saved<T>(storageKey: string) {
  const entry = readJSON<{ at: number; data: T } | null>(storageKey, null);
  return entry ? { initialData: entry.data, initialDataUpdatedAt: entry.at } : {};
}
const save = <T,>(storageKey: string, data: T) => { writeJSON(storageKey, { at: Date.now(), data }); return data; };

// MARK: TMDB

/** First page of a TMDB list (a row). The day is in the key: themed lists filter by date. */
export function useTmdbList(id: string, enabled = true) {
  const today = utcDay(new Date());
  return useQuery({
    queryKey: ["tmdb-list", id, 1, today],
    queryFn: async () => {
      const spec = tmdbListSpec(id);
      if (!spec) throw new Error(`Unknown list ${id}`);
      return tmdbListPage(spec, 1);
    },
    enabled,
    staleTime: 12 * hour,
  });
}

/** Every page of a TMDB list, one at a time (a "See all" page). */
export function useTmdbListPages(id: string, enabled = true) {
  const today = utcDay(new Date());
  return useInfiniteQuery({
    queryKey: ["tmdb-list-pages", id, today],
    queryFn: ({ pageParam }) => {
      const spec = tmdbListSpec(id);
      if (!spec) throw new Error(`Unknown list ${id}`);
      return tmdbListPage(spec, pageParam);
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled,
    staleTime: 12 * hour,
  });
}

// MARK: Lists from elsewhere

export function useChart(chartID: string, enabled = true) {
  const chart = charts[chartID];
  return useQuery({
    queryKey: ["trakt-chart", chartID],
    queryFn: () => chartTitles(chart).then((t) => save(`pc.lists.chart.${chartID}.v1`, t)),
    enabled: enabled && hasTrakt && Boolean(chart),
    staleTime: day,
    ...saved<ListTitle[]>(`pc.lists.chart.${chartID}.v1`),
  });
}

/** "Latest Movies" / "Latest Shows": every chill list (with a chill account) plus MyMoviz's newest, combined,
 * newest first. Either source may fail; the row shows whatever came back. */
export function useLatest(kind: MediaKind, chillConnected: boolean, enabled = true) {
  const storageKey = `pc.lists.latest.${kind}.${chillConnected ? "chill" : "open"}.v1`;
  return useQuery({
    queryKey: ["latest", kind, chillConnected],
    queryFn: async () => {
      const token = chillConnected ? readString(keys.chillToken) : null;
      const [chill, mymoviz] = await Promise.allSettled([
        token ? (kind === "tv" ? chillShows(token) : chillMovies(token)) : Promise.resolve([]),
        myMovizLatest(kind),
      ]);
      const lists = [chill, mymoviz].flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (!lists.some((l) => l.length)) throw new Error("No latest titles");
      return save(storageKey, combine(lists).filter((t) => t.kind === kind));
    },
    enabled,
    staleTime: 6 * hour,
    ...saved<ListTitle[]>(storageKey),
  });
}

/** The IMDb watchlist (or list) from Settings, as IMDb titles in IMDb's order. */
export function useIMDbWatchlist(link: string | null | undefined, enabled = true) {
  const ref = parseIMDbRef(link);
  const refKey = ref ? JSON.stringify(ref) : "";
  const storageKey = `pc.lists.imdb.${refKey}.v1`;
  return useQuery({
    queryKey: ["imdb-list", refKey],
    queryFn: () => imdbListTitles(ref!).then((t) => save(storageKey, t)),
    enabled: enabled && Boolean(ref),
    staleTime: 15 * 60_000,
    retry: false,
    ...(ref ? saved<ListTitle[]>(storageKey) : {}),
  });
}

/** The first `count` titles of a list as TMDB items (unmatched ones dropped). Titles already matched show at once;
 * growing `count` keeps what's on screen while the rest are looked up. */
export function useResolved(listKey: string, titles: ListTitle[] | undefined, count: number, enabled = true) {
  const slice = (titles ?? []).slice(0, count);
  // A refreshed list usually changes its length or its first title.
  const version = `${titles?.length ?? 0}:${titles?.[0] ? mergeKey(titles[0]) : ""}`;
  const known = slice.map(knownMatch);
  const allKnown = slice.length > 0 && known.every((k) => k !== undefined);
  return useQuery({
    queryKey: ["resolved", listKey, count, version],
    queryFn: () => resolveTitles(slice),
    enabled: enabled && slice.length > 0,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    ...(allKnown ? { initialData: uniqueItems(known.filter((k): k is CatalogItem => Boolean(k))) } : {}),
  });
}

/** Ranked chart entries with their TMDB item (rank kept even when TMDB has no match). */
export function useRankedResolved(listKey: string, titles: ListTitle[] | undefined, count: number, enabled = true) {
  const slice = (titles ?? []).slice(0, count);
  return useQuery({
    queryKey: ["ranked", listKey, count, titles?.length ?? 0, titles?.[0] ? mergeKey(titles[0]) : ""],
    queryFn: async () => {
      const found = await mapLimited(slice, 6, resolveTitle);
      return slice.map((entry, i) => ({ entry, item: found[i] }));
    },
    enabled: enabled && slice.length > 0,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

// MARK: Coming Up

export interface BoxOfficeItem { entry: BoxOfficeEntry; item: CatalogItem }

/** Last weekend's US box office with each movie's TMDB item. */
export function useBoxOffice(enabled = true) {
  return useQuery({
    queryKey: ["box-office"],
    queryFn: async () => {
      const entries = await boxOffice();
      const found = await mapLimited(entries, 6, resolveTitle);
      return entries.flatMap((entry, i): BoxOfficeItem[] => (found[i] ? [{ entry, item: found[i]! }] : []));
    },
    enabled: enabled && hasTrakt,
    staleTime: 6 * hour,
  });
}

/** Next scheduled episode of each show (up to 40), six lookups at a time. */
export function useNextEpisodes(showIDs: number[], enabled = true) {
  const ids = showIDs.slice(0, 40);
  return useQuery({
    queryKey: ["next-episodes", ids.join(",")],
    queryFn: async () => (await mapLimited(ids, 6, nextEpisode)).filter((e): e is NonNullable<typeof e> => Boolean(e)),
    enabled: enabled && ids.length > 0,
    staleTime: 6 * hour,
  });
}
