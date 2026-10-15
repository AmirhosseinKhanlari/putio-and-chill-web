import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { image, tmdb } from "../api/tmdb";
import { PosterCard, titlePath } from "../components/Cards";
import { useGetAndWatch, VersionsDialog, type GetTarget } from "../components/GetAndWatch";
import { CloseIcon, PlayIcon, SearchIcon } from "../components/Icons";
import { TopBar } from "../components/TopBar";
import { keys, readJSON, writeJSON } from "../lib/storage";
import { useInPutio } from "./Home";

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function Search() {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => readJSON(keys.recentSearches, []));
  const [versions, setVersions] = useState<GetTarget | null>(null);
  const q = useDebounced(query.trim(), 300);
  const results = useQuery({ queryKey: ["search", q], queryFn: () => tmdb.search(q), enabled: q.length > 1, staleTime: 10 * 60_000 });
  const trending = useQuery({ queryKey: ["trending", "all"], queryFn: () => tmdb.trending("all"), staleTime: 24 * 60 * 60_000 });
  const inPutio = useInPutio();
  const get = useGetAndWatch();
  const [top, ...rest] = results.data ?? [];

  function remember() {
    if (!q) return;
    const next = [q, ...recent.filter((r) => r !== q)].slice(0, 8);
    setRecent(next);
    writeJSON(keys.recentSearches, next);
  }

  return (
    <div className="page">
      <TopBar />
      <div className="page-body narrow">
        <form className="search-field" role="search" onSubmit={(e) => { e.preventDefault(); remember(); }}>
          <SearchIcon size={20} />
          <label className="visually-hidden" htmlFor="q">Search movies, shows and people</label>
          <input id="q" type="search" autoFocus placeholder="Movies, shows, people" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button type="button" className="icon-button icon-button-plain" aria-label="Clear search" onClick={() => setQuery("")}><CloseIcon /></button>}
        </form>

        <div className="chips">
          {q && (
            <button type="button" className="pill" disabled={!get.canGet} title={get.canGet ? undefined : "Connect chill.institute in Settings"}
              onClick={() => { remember(); setVersions({ item: { tmdbID: 0, kind: "movie", title: q }, text: q }); }}>
              Search releases for “{q}”
            </button>
          )}
          {!q && recent.length > 0 && <span className="muted small">Recent</span>}
          {!q && recent.map((r) => <button key={r} type="button" className="chip" onClick={() => setQuery(r)}>{r}</button>)}
        </div>

        {q.length > 1 && results.isSuccess && !results.data.length && <p className="muted">No movies or shows match “{q}”.</p>}

        {top && (
          <section className="stack-small">
            <h2 className="eyebrow">TOP RESULT</h2>
            <Link to={titlePath(top)} className="top-result">
              {top.posterPath ? <img src={image(top.posterPath, "w185")} alt="" /> : <div className="top-result-fallback" />}
              <div className="top-result-text">
                <div className="top-result-title">{top.title}</div>
                <div className="muted small">{top.kind === "tv" ? "Series" : "Movie"}{top.year ? ` · ${top.year}` : ""}{inPutio(top) ? " · In put.io" : ""}</div>
                {top.overview && <p className="clamp-3">{top.overview}</p>}
              </div>
              <span className="pill pill-primary pill-small"><PlayIcon size={12} />{inPutio(top) ? "Open" : "Get & Watch"}</span>
            </Link>
          </section>
        )}

        {rest.length > 0 && (
          <section className="stack-small">
            <h2>Movies &amp; shows</h2>
            <div className="grid">{rest.map((i) => <PosterCard key={`${i.kind}-${i.tmdbID}`} item={i} inPutio={inPutio(i)} />)}</div>
          </section>
        )}

        {!q && trending.data && (
          <section className="stack-small">
            <h2>Trending</h2>
            <div className="grid">{trending.data.slice(0, 18).map((i) => <PosterCard key={`${i.kind}-${i.tmdbID}`} item={i} inPutio={inPutio(i)} />)}</div>
          </section>
        )}
      </div>
      {versions && <VersionsDialog target={versions} onClose={() => setVersions(null)} />}
    </div>
  );
}
