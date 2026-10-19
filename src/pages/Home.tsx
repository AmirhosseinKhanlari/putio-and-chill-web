import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useChart, useIMDbWatchlist, useLatest, useRankedResolved, useResolved, useTmdbList } from "../api/lists/queries";
import { curatedFor, curatedTitles, genres, tmdbListID } from "../api/lists/tmdbLists";
import { chartFor } from "../api/lists/trakt";
import { tmdb, type CatalogItem, type MediaKind } from "../api/tmdb";
import { EntryCard, Poster, PosterCard, titlePath } from "../components/Cards";
import { Hero } from "../components/Hero";
import { CheckIcon, DiceIcon } from "../components/Icons";
import { Shelf } from "../components/Shelf";
import { useSettings } from "../lib/settings";
import { useLibrary, useMyList, usePositionChecks } from "../state/hooks";
import { useSession } from "../state/session";
import "../styles/lists.css";

export function useInPutio() {
  const lib = useLibrary();
  const set = new Set(lib.entries.flatMap((e) => (e.match ? [`${e.match.kind}-${e.match.tmdbID}`] : [])));
  return (item: Pick<CatalogItem, "kind" | "tmdbID">) => set.has(`${item.kind}-${item.tmdbID}`);
}

export function CatalogShelf({ title, items, seeAll }: { title: string; items?: CatalogItem[]; seeAll?: string }) {
  const inPutio = useInPutio();
  if (!items?.length) return null;
  return (
    <Shelf title={title} seeAll={seeAll}>
      {items.map((item) => <PosterCard key={`${item.kind}-${item.tmdbID}`} item={item} inPutio={inPutio(item)} />)}
    </Shelf>
  );
}

/** True once the element comes within `margin` of the screen (and stays true), so rows further down only load when
 * someone scrolls toward them. */
export function useNearViewport<T extends Element>(margin = "600px"): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setNear(true);
    }, { rootMargin: margin });
    observer.observe(el);
    return () => observer.disconnect();
  }, [near, margin]);
  return [ref, near];
}

/** Holds a row's place until it has titles; a row that fails or comes back empty simply isn't there. */
function RowSlot({ slot, state }: { slot: RefObject<HTMLDivElement>; state: "waiting" | "empty" }) {
  if (state === "empty") return null;
  return <div ref={slot} className="lists-slot" aria-hidden="true" />;
}

/** A TMDB list as a row, loaded when it nears the screen; "See all" opens every page of it. */
export function TmdbShelf({ id, title, seeAll = true }: { id: string; title: string; seeAll?: boolean }) {
  const [slot, near] = useNearViewport<HTMLDivElement>();
  const list = useTmdbList(id, near);
  if (!list.data?.items.length) return <RowSlot slot={slot} state={list.isError || list.data ? "empty" : "waiting"} />;
  return <CatalogShelf title={title} items={list.data.items} seeAll={seeAll ? `/list/tmdb/${id}` : undefined} />;
}

/** IMDb Top 250 (via Trakt): big rank numerals beside the posters. */
export function ChartShelf({ kind }: { kind: MediaKind }) {
  const chart = chartFor(kind);
  const [slot, near] = useNearViewport<HTMLDivElement>();
  const entries = useChart(chart.id, near);
  const ranked = useRankedResolved(chart.id, entries.data, 20, near);
  const inPutio = useInPutio();
  if (!ranked.data?.length) return <RowSlot slot={slot} state={entries.isError || (entries.data && !entries.data.length) ? "empty" : "waiting"} />;
  return (
    <div className="lists-chart">
      <Shelf title={chart.title} seeAll={`/list/trakt/${chart.id}`}>
        {ranked.data.map(({ entry, item }) => (
          <RankedCard key={`${entry.rank}-${entry.imdbID ?? entry.title}`} rank={entry.rank ?? 0} title={entry.title} item={item} inPutio={item ? inPutio(item) : false} />
        ))}
      </Shelf>
      <p className="lists-credit">Lists from Trakt</p>
    </div>
  );
}

function RankedCard({ rank, title, item, inPutio }: { rank: number; title: string; item?: CatalogItem; inPutio: boolean }) {
  const body = (
    <>
      <span className="ranked-number" aria-hidden="true">{rank}</span>
      <Poster path={item?.posterPath} title={title}>
        {inPutio && <span className="badge-in-putio" role="img" aria-label="In put.io"><CheckIcon size={13} /></span>}
      </Poster>
    </>
  );
  return item
    ? <Link to={titlePath(item)} className="ranked-card" aria-label={`Number ${rank}, ${title}`}>{body}</Link>
    : <div className="ranked-card" role="img" aria-label={`Number ${rank}, ${title}`}>{body}</div>;
}

/** "Latest Movies" / "Latest Shows": chill.institute's lists (when connected) and MyMoviz's newest, combined. */
export function LatestShelf({ kind }: { kind: MediaKind }) {
  const { chill } = useSession();
  const [slot, near] = useNearViewport<HTMLDivElement>();
  const titles = useLatest(kind, Boolean(chill), near);
  const resolved = useResolved(`latest-${kind}`, titles.data, 30, near);
  const list = resolved.data?.filter((i) => i.kind === kind);
  if (!list?.length) return <RowSlot slot={slot} state={titles.isError || resolved.isError || (resolved.data && !list?.length) ? "empty" : "waiting"} />;
  return <CatalogShelf title={kind === "tv" ? "Latest Shows" : "Latest Movies"} items={list} seeAll={`/list/latest/${kind}`} />;
}

/** The public IMDb watchlist linked in Settings. */
function IMDbWatchlistShelf({ link }: { link: string }) {
  const titles = useIMDbWatchlist(link);
  const resolved = useResolved(`imdb-${link}`, titles.data, 30);
  return <CatalogShelf title="IMDb Watchlist" items={resolved.data} seeAll="/list/imdb/watchlist" />;
}

const day = 24 * 60 * 60_000;

export function Home() {
  const lib = useLibrary();
  const myList = useMyList();
  const settings = useSettings();
  const navigate = useNavigate();
  const trending = useQuery({ queryKey: ["trending", "all"], queryFn: () => tmdb.trending("all"), staleTime: day });
  usePositionChecks();
  const continueWatching = lib.continueWatching();
  const recent = lib.recentlyAdded();
  // The title last watched: its recommendations become "Because you watched …".
  const last = continueWatching.find((e) => e.match)?.match;
  const lastDetail = useQuery({
    queryKey: ["detail", last?.kind, last?.tmdbID],
    queryFn: () => tmdb.detail(last!.kind, last!.tmdbID),
    enabled: Boolean(last),
    staleTime: 60 * 60_000,
  });

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
          <button type="button" className="pill pill-primary pill-small" onClick={() => navigate("/surprise")}>Surprise me</button>
        </div>

        {lib.isRefreshing && !lib.entries.length && <p className="muted">{lib.progressText}</p>}

        {continueWatching.length > 0 && (
          <Shelf title="Continue Watching">
            {continueWatching.map((e) => <EntryCard key={e.id} entry={e} />)}
          </Shelf>
        )}
        <CatalogShelf title="My List" items={myList.items} seeAll="/list/mylist/all" />
        {recent.length > 0 && (
          <Shelf title="Recently Added to put.io" seeAll="/library">
            {recent.map((e) => <EntryCard key={e.id} entry={e} />)}
          </Shelf>
        )}
        {settings.imdbWatchlist && <IMDbWatchlistShelf link={settings.imdbWatchlist} />}
        <CatalogShelf title="Trending Now" items={trending.data} seeAll={`/list/tmdb/${tmdbListID.trending("all")}`} />
        {last && (
          <CatalogShelf
            title={`Because you watched ${last.title}`}
            items={lastDetail.data?.recommendations}
            seeAll={`/list/tmdb/${tmdbListID.recommendations(last.kind, last.tmdbID)}?title=${encodeURIComponent(`Because you watched ${last.title}`)}`}
          />
        )}
        <TmdbShelf id={tmdbListID.popular("movie")} title="Popular Movies" />
        <TmdbShelf id={tmdbListID.popular("tv")} title="Popular TV" />
      </div>
    </div>
  );
}

/** Movies and TV: what's new (put.io, chill.institute, MyMoviz), IMDb's Top 250, then TMDB's lists and genres, in
 * the iPhone app's order. */
export function Browse({ kind }: { kind: MediaKind }) {
  const lib = useLibrary();
  // The slider: New Series for TV (fresh shows rather than long-running ones), Popular for movies.
  const featuredID = kind === "tv" ? tmdbListID.curated("tv", "new-series") : tmdbListID.popular("movie");
  const featured = useTmdbList(featuredID);
  const popular = useTmdbList(tmdbListID.popular(kind));
  const heroItems = featured.data?.items.some((i) => i.backdropPath) ? featured.data.items : popular.data?.items ?? [];
  const recent = lib.recentlyAdded(400).filter((e) => e.match?.kind === kind).slice(0, 30);

  return (
    <div className="page">
      <Hero items={heroItems} label={kind === "tv" && heroItems === featured.data?.items ? "NEW SERIES" : "POPULAR"} />
      <div className="page-body page-body-under-hero">
        {recent.length > 0 && (
          <Shelf title="Recently Added to put.io" seeAll="/library">
            {recent.map((e) => <EntryCard key={e.id} entry={e} />)}
          </Shelf>
        )}
        <LatestShelf kind={kind} />
        <ChartShelf kind={kind} />
        <TmdbShelf id={tmdbListID.popular(kind)} title="Popular" />
        {curatedFor(kind).map((list) => <TmdbShelf key={list} id={tmdbListID.curated(kind, list)} title={curatedTitles[list]} />)}
        <TmdbShelf id={tmdbListID.topRated(kind)} title="Top Rated" />
        {genres[kind].map((g) => <TmdbShelf key={g.id} id={tmdbListID.genre(kind, g.id)} title={g.name} />)}
      </div>
    </div>
  );
}
