/** Continue Watching with Up Next worked out: the library's items (library.ts), with each finished episode's next
 * one found from TMDB's seasons (upNext.ts). A show whose next episode hasn't aired leaves the row; seasons are
 * read again after a few hours, so a new episode shows up once it airs. */
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { tmdb, type CatalogItem, type Episode } from "../api/tmdb";
import type { LibraryEntry } from "../lib/library";
import { upNextAfter, type SeasonLookup, type UpNext, type UpNextResult } from "../lib/upNext";
import { entryItem, useLibrary } from "./hooks";

export type ContinueCard =
  | { kind: "resume"; entry: LibraryEntry }
  | { kind: "upNext"; show: CatalogItem; next: UpNext };

const SEASON_STALE_MS = 6 * 60 * 60_000;

type SeasonKey = { tmdbID: number; season: number };
const keyOf = ({ tmdbID, season }: SeasonKey) => `${tmdbID}-${season}`;

/** TMDB's seasons, each asked once (the title page's episode list shares them). */
function useSeasons(wanted: SeasonKey[]): Map<string, Episode[] | null> {
  const unique = [...new Map(wanted.map((k) => [keyOf(k), k])).values()];
  const results: UseQueryResult<Episode[]>[] = useQueries({
    queries: unique.map(({ tmdbID, season }) => ({
      queryKey: ["season", tmdbID, season],
      queryFn: () => tmdb.season(tmdbID, season),
      staleTime: SEASON_STALE_MS,
    })),
  });
  const known = new Map<string, Episode[] | null>();
  unique.forEach((k, i) => {
    const q = results[i];
    // Settled only: data, or null when TMDB failed (the library's files stand in).
    if (q.data) known.set(keyOf(k), q.data);
    else if (q.isError) known.set(keyOf(k), null);
  });
  return known;
}

const today = () => new Date().toISOString().slice(0, 10);

export function useContinueWatching(): ContinueCard[] {
  const lib = useLibrary();
  const items = lib.continueWatchingItems();
  const finished = items.flatMap((i) => (i.kind === "upNext" ? [{ entry: i.finished, show: i.finished.match! }] : []));
  const work = (seasons: Map<string, Episode[] | null>) => finished.map(({ show }): UpNextResult => {
    const lookup: SeasonLookup = (season) => seasons.get(keyOf({ tmdbID: show.tmdbID, season }));
    const files = lib.matching(show.tmdbID).filter((e) => e.match?.kind === "tv");
    return upNextAfter({ season: show.season!, episode: show.episode! }, files, lookup, today());
  });
  // The finished episodes' seasons first; a next season only for those with nothing after it.
  const current = useSeasons(finished.map(({ show }) => ({ tmdbID: show.tmdbID, season: show.season! })));
  const firstPass = work(current);
  const following = useSeasons(finished.flatMap(({ show }, i) => {
    const r = firstPass[i];
    return "loading" in r && r.loading !== show.season ? [{ tmdbID: show.tmdbID, season: r.loading }] : [];
  }));
  const results = work(new Map([...current, ...following]));

  return items.flatMap((item): ContinueCard[] => {
    if (item.kind === "resume") return [{ kind: "resume", entry: item.entry }];
    const r = results[finished.findIndex((f) => f.entry === item.finished)];
    return "next" in r && r.next ? [{ kind: "upNext", show: entryItem(item.finished)!, next: r.next }] : [];
  });
}
