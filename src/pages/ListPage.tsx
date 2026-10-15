import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { IMDbPrivateError } from "../api/lists/imdb";
import { useChart, useIMDbWatchlist, useLatest, useRankedResolved, useResolved, useTmdbListPages } from "../api/lists/queries";
import { localDay, shortDate, tmdbListSpec } from "../api/lists/tmdbLists";
import { charts } from "../api/lists/trakt";
import type { CatalogItem, MediaKind } from "../api/tmdb";
import { Poster, PosterCard, titlePath } from "../components/Cards";
import { CheckIcon, ChevronRight } from "../components/Icons";
import { TopBar } from "../components/TopBar";
import { useSettings } from "../lib/settings";
import { useMyList } from "../state/hooks";
import { useSession } from "../state/session";
import { useInPutio } from "./Home";
import "../styles/lists.css";

/** "See all" for any row: /list/tmdb/:id (TMDB, page by page), /list/trakt/:chart (ranked), /list/latest/:kind,
 * /list/imdb/watchlist and /list/mylist/all. */
export function ListPage() {
  const { source = "", id = "" } = useParams();
  return (
    <div className="page">
      <TopBar back />
      <div className="page-body narrow">
        {source === "tmdb" ? <TmdbList id={id} />
          : source === "trakt" && charts[id] ? <ChartList id={id} />
          : source === "latest" && (id === "movie" || id === "tv") ? <LatestList kind={id} />
          : source === "imdb" ? <IMDbList />
          : source === "mylist" ? <MyListList />
          : <Missing />}
      </div>
    </div>
  );
}

function Heading({ eyebrow, title, note }: { eyebrow?: string; title: string; note?: string }) {
  return (
    <div className="page-title">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1 className="display-small">{title}</h1>
      {note && <p className="muted small lists-note">{note}</p>}
    </div>
  );
}

function Missing() {
  return (
    <>
      <Heading title="List not found" />
      <p className="muted">This list isn't available. <Link to="/">Back to Home</Link></p>
    </>
  );
}

function Status({ loading, failed, empty, children }: { loading: boolean; failed: boolean; empty: boolean; children?: React.ReactNode }) {
  if (loading) return <p className="muted" role="status">Loading…</p>;
  if (failed) return <p className="muted" role="status">{children ?? "Couldn't load this list. Try again later."}</p>;
  if (empty) return <p className="muted" role="status">Nothing here yet.</p>;
  return null;
}

/** Loads more when the end of the grid comes near; the button does the same for keyboards and screen readers. */
function MoreButton({ hasMore, loading, onMore }: { hasMore: boolean; loading: boolean; onMore: () => void }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const latest = useRef(onMore);
  latest.current = onMore;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) latest.current();
    }, { rootMargin: "800px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading]);
  if (!hasMore) return null;
  return (
    <div ref={sentinel} className="lists-more">
      <button type="button" className="pill" disabled={loading} onClick={onMore}>{loading ? "Loading…" : "Show more"}</button>
    </div>
  );
}

function Grid({ items, dates }: { items: CatalogItem[]; dates?: Map<string, string | undefined> }) {
  const inPutio = useInPutio();
  return (
    <div className="grid lists-grid">
      {items.map((item) => {
        const date = shortDate(dates?.get(`${item.kind}-${item.tmdbID}`));
        return (
          <div key={`${item.kind}-${item.tmdbID}`} className="lists-grid-cell">
            <PosterCard item={item} inPutio={inPutio(item)} />
            {date && <time className="lists-date" dateTime={dates?.get(`${item.kind}-${item.tmdbID}`)}>{date}</time>}
          </div>
        );
      })}
    </div>
  );
}

// MARK: Sources

function TmdbList({ id }: { id: string }) {
  const [params] = useSearchParams();
  const spec = tmdbListSpec(id);
  const pages = useTmdbListPages(id, Boolean(spec));
  if (!spec) return <Missing />;
  const today = localDay(new Date());
  // Coming Soon and Premiering Soon: only what hasn't come out yet.
  const dated = (pages.data?.pages ?? []).flatMap((p) => p.dated).filter((d) => !spec.dated || (d.date ?? "") >= today);
  // TMDB pages can repeat a title when popularity shifts between requests.
  const seen = new Set<string>();
  const unique = dated.filter((d) => {
    const key = `${d.item.kind}-${d.item.tmdbID}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const items = unique.map((d) => d.item);
  const dates = spec.dated ? new Map(unique.map((d) => [`${d.item.kind}-${d.item.tmdbID}`, d.date])) : undefined;
  return (
    <>
      <Heading eyebrow={spec.kind === "tv" ? "TV" : spec.kind === "movie" ? "MOVIES" : undefined} title={params.get("title") || spec.title} />
      <Status loading={pages.isLoading} failed={pages.isError} empty={!items.length} />
      {items.length > 0 && <Grid items={items} dates={dates} />}
      <MoreButton hasMore={Boolean(pages.hasNextPage)} loading={pages.isFetchingNextPage} onMore={() => void pages.fetchNextPage()} />
    </>
  );
}

const STEP = 40;

/** IMDb Top 250 as a ranked list, like the iPhone app's chart page. */
function ChartList({ id }: { id: string }) {
  const chart = charts[id];
  const [count, setCount] = useState(STEP);
  const entries = useChart(id);
  const ranked = useRankedResolved(id, entries.data, count);
  const inPutio = useInPutio();
  const total = entries.data?.length ?? 0;
  return (
    <>
      <Heading eyebrow="IMDB TOP 250" title={chart.kind === "tv" ? "TV Shows" : "Movies"}
        note={total ? `${total} titles, ranked by IMDb users` : "Ranked by IMDb users"} />
      <Status loading={entries.isLoading || (ranked.isLoading && !ranked.data)} failed={entries.isError} empty={!total}>
        Couldn't load the chart. Try again later.
      </Status>
      {ranked.data && (
        <ol className="chart-list">
          {ranked.data.map(({ entry, item }) => {
            const body = (
              <>
                <span className={`chart-rank chart-rank-${Math.min(entry.rank ?? 99, 4)}`} aria-hidden="true">{entry.rank}</span>
                <div className="chart-poster"><Poster path={item?.posterPath} title={entry.title} /></div>
                <div className="chart-text">
                  <div className="chart-title">{entry.title}</div>
                  <div className="meta-row small">
                    {entry.year && <span>{entry.year}</span>}
                    {item?.rating ? <span>★ {item.rating.toFixed(1)}</span> : null}
                    {item && inPutio(item) && <span className="in-putio"><CheckIcon size={14} />In put.io</span>}
                  </div>
                  {item?.overview && <p className="chart-overview">{item.overview}</p>}
                </div>
                {item && <ChevronRight size={16} />}
              </>
            );
            return (
              <li key={`${entry.rank}-${entry.imdbID ?? entry.title}`}>
                {item
                  ? <Link to={titlePath(item)} className="chart-row" aria-label={`Number ${entry.rank}, ${entry.title}`}>{body}</Link>
                  : <div className="chart-row">{body}</div>}
              </li>
            );
          })}
        </ol>
      )}
      <MoreButton hasMore={count < total && Boolean(ranked.data)} loading={ranked.isFetching} onMore={() => setCount((c) => c + STEP)} />
      {total > 0 && <p className="lists-credit">Lists from Trakt</p>}
    </>
  );
}

function LatestList({ kind }: { kind: MediaKind }) {
  const { chill } = useSession();
  const [count, setCount] = useState(STEP);
  const titles = useLatest(kind, Boolean(chill));
  const resolved = useResolved(`latest-${kind}`, titles.data, count);
  const items = (resolved.data ?? []).filter((i) => i.kind === kind);
  const total = titles.data?.length ?? 0;
  return (
    <>
      <Heading eyebrow={kind === "tv" ? "TV" : "MOVIES"} title={kind === "tv" ? "Latest Shows" : "Latest Movies"}
        note={chill ? "From chill.institute and MyMoviz, newest first" : "From MyMoviz, newest first. Connect chill.institute in Settings for more."} />
      <Status loading={titles.isLoading || (resolved.isLoading && !resolved.data)} failed={titles.isError} empty={!items.length} />
      {items.length > 0 && <Grid items={items} />}
      <MoreButton hasMore={count < total && Boolean(resolved.data)} loading={resolved.isFetching} onMore={() => setCount((c) => c + STEP)} />
    </>
  );
}

function IMDbList() {
  const settings = useSettings();
  const [count, setCount] = useState(60);
  const titles = useIMDbWatchlist(settings.imdbWatchlist);
  const resolved = useResolved(`imdb-${settings.imdbWatchlist}`, titles.data, count);
  const total = titles.data?.length ?? 0;
  if (!settings.imdbWatchlist) {
    return (
      <>
        <Heading title="IMDb Watchlist" />
        <p className="muted">Add the link to your public IMDb watchlist in <Link to="/settings">Settings</Link> to see it here.</p>
      </>
    );
  }
  return (
    <>
      <Heading eyebrow="IMDB" title="Watchlist" note={total ? `${total} titles` : undefined} />
      <Status loading={titles.isLoading || (resolved.isLoading && !resolved.data)} failed={titles.isError && !titles.data} empty={!resolved.data?.length}>
        {titles.error instanceof IMDbPrivateError ? titles.error.message : "Couldn't reach IMDb. Try again later."}
      </Status>
      {resolved.data && resolved.data.length > 0 && <Grid items={resolved.data} />}
      <MoreButton hasMore={count < total && Boolean(resolved.data)} loading={resolved.isFetching} onMore={() => setCount((c) => c + 60)} />
    </>
  );
}

function MyListList() {
  const myList = useMyList();
  const [filter, setFilter] = useState<"all" | MediaKind>("all");
  const items = myList.items.filter((i) => filter === "all" || i.kind === filter);
  return (
    <>
      <Heading title="My List" note={`${myList.items.length} ${myList.items.length === 1 ? "title" : "titles"}`} />
      {myList.items.length > 0 && (
        <div className="segmented lists-segmented" role="group" aria-label="Show">
          {(["all", "movie", "tv"] as const).map((f) => (
            <button key={f} type="button" className={filter === f ? "segment segment-on" : "segment"} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "movie" ? "Movies" : "TV"}
            </button>
          ))}
        </div>
      )}
      {!myList.items.length && <p className="muted">Titles you add with My List show up here.</p>}
      {items.length > 0 && <Grid items={items} />}
    </>
  );
}
