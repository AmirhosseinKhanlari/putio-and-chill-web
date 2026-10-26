import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { image, tmdb, type Episode, type MediaKind, type TitleDetail } from "../api/tmdb";
import { playPath, WatchedBar, WatchedChip } from "../components/Cards";
import { useGetAndWatch, VersionsDialog, type GetTarget } from "../components/GetAndWatch";
import { CheckIcon, CloudDown, InfoIcon, LayersIcon, MoreIcon, PlayIcon, PlusIcon, TrailerIcon } from "../components/Icons";
import { TopBar } from "../components/TopBar";
import { left as leftLabel, runtime } from "../lib/format";
import type { LibraryEntry } from "../lib/library";
import { useContinueWatching } from "../state/continueWatching";
import { useLibrary, useMyList } from "../state/hooks";
import { CatalogShelf } from "./Home";
// Cast & Crew links share the person page's styles.
import "../styles/person.css";

export function Title() {
  const { kind, id } = useParams<{ kind: MediaKind; id: string }>();
  const tmdbID = Number(id);
  const detail = useQuery({ queryKey: ["detail", kind, tmdbID], queryFn: () => tmdb.detail(kind!, tmdbID), staleTime: 60 * 60_000 });
  useEffect(() => { window.scrollTo(0, 0); }, [kind, tmdbID]);

  if (detail.isError) {
    return <div className="page"><TopBar back /><div className="page-body narrow"><p className="error-text">Couldn't load this title.</p></div></div>;
  }
  if (!detail.data) return <div className="page"><TopBar back /><div className="page-body narrow"><p className="muted">Loading…</p></div></div>;
  return <TitleView key={`${kind}-${tmdbID}`} detail={detail.data} />;
}

function TitleView({ detail }: { detail: TitleDetail }) {
  const { item } = detail;
  const lib = useLibrary();
  const myList = useMyList();
  const get = useGetAndWatch();
  const [versions, setVersions] = useState<GetTarget | null>(null);
  const [trailer, setTrailer] = useState(false);
  const files = lib.matching(item.tmdbID).filter((e) => e.match?.kind === item.kind);
  // Continue Watching's card for this title: an episode to resume, or (a finished one's) next episode.
  const card = useContinueWatching().find((c) => (c.kind === "resume" ? c.entry.match : c.show)?.tmdbID === item.tmdbID
    && (c.kind === "resume" ? c.entry.match?.kind : c.show.kind) === item.kind);
  const started = card?.kind === "resume" ? card.entry : undefined;
  const upNext = card?.kind === "upNext" ? card.next : undefined;
  const firstFile = [...files].sort(byEpisode)[0];
  const playable = started ?? upNext?.entry ?? firstFile;
  const remaining = playable ? lib.remainingSeconds(playable, (detail.runtimeMinutes ?? 0) * 60 || undefined) : undefined;
  const code = playable?.match?.season !== undefined ? `S${playable.match.season} E${playable.match.episode ?? ""}` : "";
  const playLabel = started ? ["Resume", code, remaining !== undefined ? leftLabel(remaining) : ""].filter(Boolean).join(" · ").replace("Resume · ", "Resume ")
    : upNext?.entry ? `Play ${code}` : "Play";
  const target: GetTarget = { item, imdbID: detail.imdbID };

  return (
    <div className="page">
      <section className="hero hero-title" aria-label={item.title}>
        {item.backdropPath && <img className="hero-image" src={image(item.backdropPath, "w1280")} alt="" />}
        <div className="hero-scrim" />
        <TopBar back overlay />
        <div className="hero-content">
          <h1 className="display">{item.title}</h1>
          <div className="meta-row">
            {item.year && <span>{item.year}</span>}
            {runtime(detail.runtimeMinutes) && <span>{runtime(detail.runtimeMinutes)}</span>}
            {item.kind === "tv" && detail.numberOfSeasons ? <span>{detail.numberOfSeasons} season{detail.numberOfSeasons === 1 ? "" : "s"}</span> : null}
            {files.length > 0 && <span className="in-putio"><CheckIcon size={15} />In put.io</span>}
            {item.rating ? <><span className="badge-tmdb">TMDB</span><span className="strong">{Math.round(item.rating * 10)}%</span></> : null}
            {detail.imdbID && <a className="badge-imdb" href={`https://www.imdb.com/title/${detail.imdbID}/`} target="_blank" rel="noreferrer">IMDb</a>}
          </div>
          {item.overview && <p className="hero-overview">{item.overview}</p>}
          {detail.genres.length > 0 && <div className="muted small">{detail.genres.join(" · ")}</div>}
          <div className="actions">
            {playable ? (
              <Link to={upNext?.entry ? `${playPath(playable.id)}?from=0` : playPath(playable.id)} className="pill pill-primary">
                <PlayIcon size={16} />{playLabel}
              </Link>
            ) : item.kind === "movie" ? (
              <button type="button" className="pill pill-primary" disabled={get.busy} onClick={() => get.getBest(target)}>
                <PlayIcon size={16} />{get.busy ? "Getting…" : "Get & Watch"}
              </button>
            ) : null}
            {item.kind === "movie" && <button type="button" className="pill" onClick={() => setVersions(target)}><LayersIcon />Versions</button>}
            <button type="button" className="pill" aria-pressed={myList.has(item)} onClick={() => myList.toggle(item)}>
              {myList.has(item) ? <CheckIcon /> : <PlusIcon />}My List
            </button>
            {detail.trailerKey && <button type="button" className="pill" onClick={() => setTrailer(true)}><TrailerIcon />Trailer</button>}
          </div>
        </div>
      </section>

      <div className="page-body">
        {item.kind === "tv" && <Episodes detail={detail} upNext={upNext} onVersions={setVersions} />}
        {detail.cast.length > 0 && (
          <section className="shelf">
            <div className="shelf-head"><h2>Cast &amp; Crew</h2></div>
            <div className="cast">
              {detail.cast.map((c) => (
                <Link key={`${c.id}-${c.role}`} to={`/person/${c.id}`} className="cast-member">
                  {c.profilePath ? <img src={image(c.profilePath, "w185")} alt="" loading="lazy" /> : <div className="cast-fallback" aria-hidden="true">{initials(c.name)}</div>}
                  <div className="small strong">{c.name}</div>
                  {c.role && <div className="small muted">{c.role}</div>}
                </Link>
              ))}
            </div>
          </section>
        )}
        <CatalogShelf title="More Like This" items={detail.recommendations} />
      </div>

      {versions && <VersionsDialog target={versions} onClose={() => setVersions(null)} />}
      {trailer && detail.trailerKey && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setTrailer(false)}>
          <div className="trailer" role="dialog" aria-modal="true" aria-label={`${item.title} trailer`}>
            <iframe src={`https://www.youtube-nocookie.com/embed/${detail.trailerKey}?autoplay=1`} title={`${item.title} trailer`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
          </div>
        </div>
      )}
    </div>
  );
}

const byEpisode = (a: LibraryEntry, b: LibraryEntry) => ((a.match?.season ?? 0) - (b.match?.season ?? 0)) || ((a.match?.episode ?? 0) - (b.match?.episode ?? 0));
const initials = (name: string) => name.split(" ").map((w) => w[0]).join("").slice(0, 2);

function Episodes({ detail, upNext, onVersions }: { detail: TitleDetail; upNext?: { season: number }; onVersions: (t: GetTarget) => void }) {
  const lib = useLibrary();
  const get = useGetAndWatch();
  const { item } = detail;
  // Open on the episode asked for (an Up Next card that isn't in put.io), else the season being watched (Up Next's,
  // or the latest started episode's), else the first.
  const [params] = useSearchParams();
  const asked = Number(params.get("season")) || undefined;
  const askedEpisode = Number(params.get("episode")) || undefined;
  const watching = upNext?.season ?? lib.matching(item.tmdbID).filter((e) => lib.resumeSeconds(e) >= 30 && e.match?.season !== undefined).sort(byEpisode).pop()?.match?.season;
  const [season, setSeason] = useState(() => [asked, watching].find((n) => n !== undefined && detail.seasons.some((s) => s.number === n)) ?? detail.seasons[0]?.number ?? 1);
  const episodes = useQuery({ queryKey: ["season", item.tmdbID, season], queryFn: () => tmdb.season(item.tmdbID, season), staleTime: 60 * 60_000 });
  // Scrolled to once its row is there.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !askedEpisode || season !== asked || !episodes.data) return;
    scrolled.current = true;
    document.getElementById(`episode-${askedEpisode}`)?.scrollIntoView({ block: "center" });
  }, [askedEpisode, asked, season, episodes.data]);
  const inSeason = lib.matching(item.tmdbID, season);
  const aired = (episodes.data ?? []).filter((e) => !e.airDate || e.airDate <= new Date().toISOString().slice(0, 10));
  const haveAll = aired.length > 0 && aired.every((e) => inSeason.some((f) => f.match?.episode === e.number));
  const best = Math.max(...(episodes.data ?? []).map((e) => e.rating ?? 0));
  const target: GetTarget = { item, imdbID: detail.imdbID, season };

  return (
    <section className="episodes" aria-labelledby="season-heading">
      <div className="episodes-head">
        <h2 id="season-heading" className="season-select">
          <label className="visually-hidden" htmlFor="season">Season</label>
          <select id="season" value={season} onChange={(e) => setSeason(Number(e.target.value))}>
            {detail.seasons.map((s) => <option key={s.number} value={s.number}>{s.name}</option>)}
          </select>
        </h2>
        {!haveAll && (
          <div className="actions">
            <button type="button" className="pill" disabled={get.busy} onClick={() => get.getBest(target)}><CloudDown />{get.busy ? "Getting…" : "Get season"}</button>
            <button type="button" className="pill" onClick={() => onVersions(target)}><LayersIcon />Versions</button>
          </div>
        )}
      </div>
      {episodes.isLoading && <p className="muted">Loading episodes…</p>}
      {(episodes.data ?? []).map((ep) => (
        <EpisodeRow key={ep.number} detail={detail} season={season} episode={ep} isBest={best > 0 && ep.rating === best}
          files={inSeason.filter((f) => f.match?.episode === ep.number)} onVersions={onVersions} />
      ))}
    </section>
  );
}

function EpisodeRow({ detail, season, episode, files, isBest, onVersions }: {
  detail: TitleDetail; season: number; episode: Episode; files: LibraryEntry[]; isBest: boolean; onVersions: (t: GetTarget) => void;
}) {
  const lib = useLibrary();
  const get = useGetAndWatch();
  const [menu, setMenu] = useState(false);
  const watched = [...files].sort((a, b) => lib.resumeSeconds(b) - lib.resumeSeconds(a))[0];
  const estimate = episode.runtimeMinutes ? episode.runtimeMinutes * 60 : undefined;
  const done = files.some((f) => lib.isWatched(f.id));
  const fraction = watched ? lib.watchedFraction(watched, estimate) ?? (done ? 1 : undefined) : undefined;
  const remaining = watched ? lib.remainingSeconds(watched, estimate) : undefined;
  const resume = watched ? lib.resumeSeconds(watched) : 0;
  const target: GetTarget = { item: detail.item, imdbID: detail.imdbID, season, episode: episode.number };
  const upcoming = episode.airDate && episode.airDate > new Date().toISOString().slice(0, 10);

  return (
    <div className="episode" id={`episode-${episode.number}`}>
      <div className="episode-still">
        <div className="still">
          {episode.stillPath ? <img src={image(episode.stillPath, "w500")} alt="" loading="lazy" /> : <div className="still-fallback" />}
          {resume >= 30 && remaining !== undefined && <span className="chip-left"><PlayIcon size={10} />{leftLabel(remaining)}</span>}
          {done && resume < 30 && <WatchedChip />}
        </div>
        {fraction !== undefined && <WatchedBar fraction={fraction} />}
      </div>
      <div className="episode-text">
        <div className="episode-title">{episode.number}. {episode.name}</div>
        <div className="meta-row small">
          {episode.rating ? <span className="strong">★ {episode.rating.toFixed(1)}</span> : null}
          {runtime(episode.runtimeMinutes) && <span className="muted">{runtime(episode.runtimeMinutes)}</span>}
          {upcoming && <span className="muted">Airs {episode.airDate}</span>}
          {isBest && <span className="best">★ Best of season</span>}
        </div>
        {episode.overview && <p className="episode-overview">{episode.overview}</p>}
      </div>
      <div className="episode-actions">
        {watched ? (
          <Link to={playPath(watched.id)} className="round-button round-primary" aria-label={`Play episode ${episode.number}`}><PlayIcon /></Link>
        ) : !upcoming ? (
          <button type="button" className="round-button" disabled={get.busy} aria-label={`Get episode ${episode.number}`} onClick={() => get.getBest(target)}><CloudDown size={20} /></button>
        ) : null}
        <div className="menu-anchor">
          <button type="button" className="round-button round-quiet" aria-label={`More for episode ${episode.number}`} aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreIcon /></button>
          {menu && (
            <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
              {watched && <Link role="menuitem" to={`${playPath(watched.id)}?from=0`}><PlayIcon size={14} />Start Over</Link>}
              <button type="button" role="menuitem" onClick={() => { setMenu(false); onVersions(target); }}><LayersIcon size={14} />Choose a Version…</button>
              <a role="menuitem" href={`https://www.themoviedb.org/tv/${detail.item.tmdbID}/season/${season}/episode/${episode.number}`} target="_blank" rel="noreferrer"><InfoIcon size={14} />Episode on TMDB</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
