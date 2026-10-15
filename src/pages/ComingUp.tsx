import { Link, useSearchParams } from "react-router-dom";
import { useBoxOffice, useNextEpisodes, useTmdbList } from "../api/lists/queries";
import { groupByDay, localDay, shortDate, tmdbListID, upcomingOnly, yourShows, type DatedItem } from "../api/lists/tmdbLists";
import { hasTrakt, revenueText } from "../api/lists/trakt";
import { image } from "../api/tmdb";
import { Poster, titlePath } from "../components/Cards";
import { CheckIcon } from "../components/Icons";
import { Shelf } from "../components/Shelf";
import { TopBar } from "../components/TopBar";
import { useLibrary, useMyList } from "../state/hooks";
import { CatalogShelf, useInPutio } from "./Home";
import "../styles/lists.css";

type Section = "movies" | "tv";

/** Coming Up, as on the iPhone: Movies (box office, in cinemas, coming soon) and TV (your shows' next episodes by
 * day, premieres, returning this week). The iPhone app's new-episode bell isn't here: a web page can't alert anyone
 * once it's closed. */
export function ComingUp() {
  const [params, setParams] = useSearchParams();
  const section: Section = params.get("show") === "tv" ? "tv" : "movies";
  const choose = (next: Section) => setParams(next === "tv" ? { show: "tv" } : {}, { replace: true });

  return (
    <div className="page">
      <TopBar />
      <div className="page-body narrow">
        <div className="page-title lists-head">
          <h1 className="display-small">Coming Up</h1>
          <div className="segmented lists-segmented" role="group" aria-label="Show">
            {(["movies", "tv"] as const).map((s) => (
              <button key={s} type="button" className={section === s ? "segment segment-on" : "segment"} aria-pressed={section === s} onClick={() => choose(s)}>
                {s === "movies" ? "Movies" : "TV"}
              </button>
            ))}
          </div>
        </div>
        {section === "movies" ? <Movies /> : <Shows />}
      </div>
    </div>
  );
}

// MARK: Movies

function Movies() {
  const box = useBoxOffice();
  const cinemas = useTmdbList(tmdbListID.nowPlaying);
  const upcoming = useTmdbList(tmdbListID.upcomingMovies);
  const soon = upcomingOnly(upcoming.data?.dated ?? [], localDay(new Date()));
  const loading = (hasTrakt && box.isLoading) || cinemas.isLoading || upcoming.isLoading;
  const nothing = !loading && !box.data?.length && !cinemas.data?.items.length && !soon.length;

  return (
    <>
      {box.data && box.data.length > 0 && (
        <section className="stack-small" aria-labelledby="box-office">
          <div className="section-head">
            <h2 id="box-office">Box Office This Weekend</h2>
            <span className="muted small">US · Trakt</span>
          </div>
          <ol className="box-office">
            {box.data.map(({ entry, item }) => (
              <li key={entry.rank}>
                <Link to={titlePath(item)} className="box-office-row">
                  <span className="box-office-rank">{entry.rank}</span>
                  <div className="box-office-poster"><Poster path={item.posterPath} title={item.title} /></div>
                  <div className="box-office-text">
                    <div className="strong clamp-1">{item.title}</div>
                    <div className="muted small">{[item.year, revenueText(entry.revenue) && `${revenueText(entry.revenue)} weekend`].filter(Boolean).join(" · ")}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
      <CatalogShelf title="In Cinemas Now" items={cinemas.data?.items} seeAll={`/list/tmdb/${tmdbListID.nowPlaying}`} />
      <DatedShelf title="Coming Soon to Cinemas" items={soon} seeAll={`/list/tmdb/${tmdbListID.upcomingMovies}`} />
      {loading && <p className="muted" role="status">Loading…</p>}
      {nothing && <p className="muted">Couldn't load what's in cinemas. Try again later.</p>}
    </>
  );
}

// MARK: TV

function Shows() {
  const lib = useLibrary();
  const myList = useMyList();
  const ids = yourShows(
    lib.entries.map((e) => (e.match?.kind === "tv" ? e.match.tmdbID : undefined)),
    myList.items.filter((i) => i.kind === "tv").map((i) => i.tmdbID),
  );
  const episodes = useNextEpisodes(ids);
  const premieres = useTmdbList(tmdbListID.premieres);
  const returning = useTmdbList(tmdbListID.curated("tv", "returning"));
  const now = new Date();
  const days = groupByDay(episodes.data ?? [], now);
  const premiering = upcomingOnly(premieres.data?.dated ?? [], localDay(now), true);

  return (
    <>
      <section className="stack-small" aria-labelledby="your-episodes">
        <div className="section-head">
          <h2 id="your-episodes">Your Upcoming Episodes</h2>
          <span className="muted small">Shows in put.io and My List</span>
        </div>
        {episodes.isLoading && <p className="muted" role="status">Checking your shows…</p>}
        {!episodes.isLoading && !days.length && (
          <p className="muted">{ids.length ? "Nothing scheduled in the next 30 days for your shows." : "Add shows to My List or put.io to see their next episodes here."}</p>
        )}
        {days.map((d) => (
          <div key={d.date} className="stack-small">
            <h3 className="lists-day"><time dateTime={d.date}>{d.label}</time></h3>
            <ul className="upcoming">
              {d.episodes.map((e) => {
                const still = image(e.stillPath ?? e.show.backdropPath, "w500");
                return (
                  <li key={`${e.show.tmdbID}-${e.season}-${e.episode}`}>
                    <Link to={titlePath(e.show)} className="upcoming-row">
                      {still ? <img src={still} alt="" loading="lazy" /> : <div className="upcoming-fallback" />}
                      <div>
                        <div className="strong clamp-1">{e.show.title}</div>
                        <div className="muted small clamp-1">S{e.season} E{e.episode} · {e.name}</div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
      <DatedShelf title="Premiering Soon" items={premiering} seeAll={`/list/tmdb/${tmdbListID.premieres}`} />
      <CatalogShelf title="Returning This Week" items={returning.data?.items} seeAll={`/list/tmdb/${tmdbListID.curated("tv", "returning")}`} />
    </>
  );
}

/** Posters with their release or premiere date underneath ("Oct 24"). */
function DatedShelf({ title, items, seeAll }: { title: string; items: DatedItem[]; seeAll?: string }) {
  const inPutio = useInPutio();
  if (!items.length) return null;
  return (
    <Shelf title={title} seeAll={seeAll}>
      {items.map(({ item, date }) => (
        <Link key={`${item.kind}-${item.tmdbID}`} to={titlePath(item)} className="card" title={item.title}>
          <Poster path={item.posterPath} title={item.title}>
            {inPutio(item) && <span className="badge-in-putio" role="img" aria-label="In put.io"><CheckIcon size={13} /></span>}
          </Poster>
          <span className="card-caption">{item.title}</span>
          {shortDate(date) && <time className="lists-date" dateTime={date}>{shortDate(date)}</time>}
        </Link>
      ))}
    </Shelf>
  );
}
