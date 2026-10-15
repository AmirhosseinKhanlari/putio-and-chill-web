import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { tmdb, type CatalogItem, type MediaKind } from "../api/tmdb";
import { EntryCard, PosterCard, titlePath } from "../components/Cards";
import { Hero } from "../components/Hero";
import { DiceIcon } from "../components/Icons";
import { Shelf } from "../components/Shelf";
import { useLibrary, useMyList } from "../state/hooks";

export function useInPutio() {
  const lib = useLibrary();
  const set = new Set(lib.entries.flatMap((e) => (e.match ? [`${e.match.kind}-${e.match.tmdbID}`] : [])));
  return (item: Pick<CatalogItem, "kind" | "tmdbID">) => set.has(`${item.kind}-${item.tmdbID}`);
}

export function CatalogShelf({ title, items }: { title: string; items?: CatalogItem[] }) {
  const inPutio = useInPutio();
  if (!items?.length) return null;
  return (
    <Shelf title={title}>
      {items.map((item) => <PosterCard key={`${item.kind}-${item.tmdbID}`} item={item} inPutio={inPutio(item)} />)}
    </Shelf>
  );
}

const day = 24 * 60 * 60_000;

export function Home() {
  const lib = useLibrary();
  const myList = useMyList();
  const navigate = useNavigate();
  const trending = useQuery({ queryKey: ["trending", "all"], queryFn: () => tmdb.trending("all"), staleTime: day });
  const movies = useQuery({ queryKey: ["list", "movie", "popular"], queryFn: () => tmdb.list("movie", "popular"), staleTime: day });
  const shows = useQuery({ queryKey: ["list", "tv", "popular"], queryFn: () => tmdb.list("tv", "popular"), staleTime: day });
  const continueWatching = lib.continueWatching();
  const recent = lib.recentlyAdded();

  function surprise() {
    const pool = [...(trending.data ?? []), ...(movies.data ?? []), ...(shows.data ?? [])].filter((i) => (i.rating ?? 0) >= 7);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) navigate(titlePath(pick));
  }

  return (
    <div className="page">
      <Hero items={trending.data ?? []} label="TRENDING" />
      <div className="page-body page-body-under-hero">
        <div className="surprise">
          <DiceIcon size={30} />
          <div className="surprise-text">
            <div className="strong">Can't decide?</div>
            <div className="muted small">Get a highly rated movie or series at random</div>
          </div>
          <button type="button" className="pill pill-primary pill-small" onClick={surprise}>Surprise me</button>
        </div>

        {lib.isRefreshing && !lib.entries.length && <p className="muted">{lib.progressText}</p>}

        {continueWatching.length > 0 && (
          <Shelf title="Continue Watching">
            {continueWatching.map((e) => <EntryCard key={e.id} entry={e} />)}
          </Shelf>
        )}
        {recent.length > 0 && (
          <Shelf title="Recently Added to put.io" seeAll="/library">
            {recent.map((e) => <EntryCard key={e.id} entry={e} />)}
          </Shelf>
        )}
        <CatalogShelf title="My List" items={myList.items} />
        <CatalogShelf title="Trending Now" items={trending.data} />
        <CatalogShelf title="Popular Movies" items={movies.data} />
        <CatalogShelf title="Popular Shows" items={shows.data} />
      </div>
    </div>
  );
}

const genres: Record<MediaKind, [number, string][]> = {
  movie: [[28, "Action"], [35, "Comedy"], [18, "Drama"], [878, "Sci-Fi"], [53, "Thriller"], [27, "Horror"], [16, "Animation"]],
  tv: [[10759, "Action & Adventure"], [35, "Comedy"], [18, "Drama"], [10765, "Sci-Fi & Fantasy"], [80, "Crime"], [99, "Documentary"]],
};

export function Browse({ kind }: { kind: MediaKind }) {
  const trending = useQuery({ queryKey: ["trending", kind], queryFn: () => tmdb.trending(kind), staleTime: day });
  const popular = useQuery({ queryKey: ["list", kind, "popular"], queryFn: () => tmdb.list(kind, "popular"), staleTime: day });
  const top = useQuery({ queryKey: ["list", kind, "top_rated"], queryFn: () => tmdb.list(kind, "top_rated"), staleTime: day });
  const fresh = useQuery({ queryKey: ["list", kind, kind === "movie" ? "now_playing" : "on_the_air"], queryFn: () => tmdb.list(kind, kind === "movie" ? "now_playing" : "on_the_air"), staleTime: day });
  return (
    <div className="page">
      <Hero items={trending.data ?? []} label="TRENDING" />
      <div className="page-body page-body-under-hero">
        <CatalogShelf title={kind === "movie" ? "New Movies" : "New Episodes This Week"} items={fresh.data} />
        <CatalogShelf title="Popular" items={popular.data} />
        <CatalogShelf title="Highly Rated" items={top.data} />
        {genres[kind].map(([id, name]) => <GenreShelf key={id} kind={kind} genre={id} name={name} />)}
      </div>
    </div>
  );
}

function GenreShelf({ kind, genre, name }: { kind: MediaKind; genre: number; name: string }) {
  const q = useQuery({ queryKey: ["genre", kind, genre], queryFn: () => tmdb.discover(kind, genre), staleTime: day });
  return <CatalogShelf title={name} items={q.data} />;
}
