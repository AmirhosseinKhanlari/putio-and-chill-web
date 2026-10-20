import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { image, tmdb, type CatalogItem } from "../api/tmdb";
import { library } from "../lib/library";
import { suggestedQuery, targetLabel, type FixMatchRequest } from "../lib/matchOverrides";
import { parseReleaseName } from "../lib/releaseName";
import { catalogSearch, catalogSeasonCount, useToast } from "../state/hooks";
import { Dialog } from "./files/Dialog";
import "../styles/files.css";
import "../styles/fixmatch.css";

/** Fix Match (port of the iPhone app's FixMatchModel): search TMDB for the right movie or show, for a show optionally
 * say which season the files are, choose what it applies to, then apply; or undo with Match Automatically. */
export function FixMatchDialog({ request, onClose }: { request: FixMatchRequest; onClose: () => void }) {
  const toast = useToast();
  const [query, setQuery] = useState(() => suggestedQuery(request.sampleName));
  const [searched, setSearched] = useState(query.trim());
  const [chosen, setChosen] = useState<CatalogItem>();
  // undefined keeps the season in each file name.
  const [season, setSeason] = useState<number>();
  const [targetIndex, setTargetIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const namedSeason = parseReleaseName(request.sampleName).season;
  const canUndo = library.hasOverride(request.files, request.folderID);

  const results = useQuery({
    queryKey: ["fix-match", searched],
    queryFn: async () => (await tmdb.search(searched)).filter((i) => i.kind === "movie" || i.kind === "tv"),
    enabled: searched.length > 0,
    staleTime: 10 * 60_000,
  });
  const detail = useQuery({
    queryKey: ["detail", "tv", chosen?.tmdbID],
    queryFn: () => tmdb.detail("tv", chosen!.tmdbID),
    enabled: chosen?.kind === "tv",
    staleTime: 60 * 60_000,
  });
  const seasons = chosen?.kind === "tv" ? detail.data?.seasons ?? [] : [];

  // A one-season show (a miniseries) is that season whatever the names say ("S03" of the anthology).
  const onlySeason = seasons.length === 1 ? seasons[0].number : undefined;
  useEffect(() => {
    if (onlySeason !== undefined && namedSeason !== onlySeason) setSeason(onlySeason);
  }, [onlySeason, namedSeason]);

  function search(event: FormEvent) {
    event.preventDefault();
    setSearched(query.trim());
    setChosen(undefined);
  }

  function choose(item: CatalogItem | undefined) {
    setChosen(item);
    setSeason(undefined);
  }

  function apply() {
    if (!chosen) return;
    const target = request.targets[targetIndex];
    library.fixMatch(target, {
      tmdbID: chosen.tmdbID, mediaType: chosen.kind, title: chosen.title, year: chosen.year,
      posterPath: chosen.posterPath, backdropPath: chosen.backdropPath, season: chosen.kind === "tv" ? season : undefined,
    });
    toast(`Matched to ${chosen.title}`);
    onClose();
  }

  async function undo() {
    setBusy(true);
    try {
      await library.matchAutomatically(request.files, request.folderID, catalogSearch, catalogSeasonCount);
      toast("Matching automatically again");
      onClose();
    } catch {
      toast("Couldn't match automatically right now. Try again.");
      setBusy(false);
    }
  }

  return (
    <Dialog title="Fix Match" wide busy={busy} onClose={onClose}>
      <p className="muted small files-dialog-text fix-match-name">{request.sampleName}</p>

      {!chosen ? (
        <>
          <form className="fix-match-search" onSubmit={search} role="search">
            <label htmlFor="fix-match-query" className="visually-hidden">Movie or show</label>
            <input id="fix-match-query" className="text-field" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Movie or show" autoComplete="off" spellCheck={false} data-autofocus />
            <button type="submit" className="pill" disabled={!query.trim()}>Search</button>
          </form>
          <div className="fix-match-results" aria-busy={results.isFetching}>
            {results.isLoading && <p className="muted">Searching TMDB…</p>}
            {results.isError && <p className="error-text">Couldn't search TMDB right now. Check your connection and try again.</p>}
            {results.isSuccess && !results.data.length && <p className="muted">Nothing on TMDB matches “{searched}”. Try other words.</p>}
            <ul className="fix-match-list">
              {(results.data ?? []).map((item) => (
                <li key={`${item.kind}-${item.tmdbID}`}>
                  <button type="button" className="fix-match-row" onClick={() => choose(item)}>
                    <Thumb item={item} />
                    <span className="fix-match-text">
                      <span className="strong">{item.title}</span>
                      <span className="muted small">{[item.year, item.kind === "tv" ? "Show" : "Movie"].filter(Boolean).join(" · ")}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <div className="stack-small">
          <div className="fix-match-row fix-match-chosen">
            <Thumb item={chosen} />
            <span className="fix-match-text">
              <span className="strong">{chosen.title}</span>
              <span className="muted small">{[chosen.year, chosen.kind === "tv" ? "Show" : "Movie"].filter(Boolean).join(" · ")}</span>
            </span>
            <button type="button" className="fix-match-change small" onClick={() => choose(undefined)}>Change</button>
          </div>
          {chosen.kind === "tv" && (
            <label className="fix-match-field">
              <span className="small muted">Season</span>
              <select className="select" value={season ?? ""} disabled={detail.isLoading}
                onChange={(e) => setSeason(e.target.value === "" ? undefined : Number(e.target.value))}>
                <option value="">{namedSeason !== undefined ? `As named (season ${namedSeason})` : "As named"}</option>
                {seasons.map((s) => <option key={s.number} value={s.number}>{s.name || `Season ${s.number}`}</option>)}
              </select>
              {detail.isError && <span className="small error-text">Couldn't load this show's seasons; the files keep the season in their names.</span>}
            </label>
          )}
        </div>
      )}

      {request.targets.length > 1 ? (
        <fieldset className="fix-match-targets">
          <legend className="small muted">Applies to</legend>
          {request.targets.map((t, i) => (
            <label key={i} className="fix-match-target">
              <input type="radio" name="fix-match-target" checked={targetIndex === i} onChange={() => setTargetIndex(i)} />
              <span>{targetLabel(t)}</span>
            </label>
          ))}
        </fieldset>
      ) : request.targets[0] && <p className="small muted files-dialog-text">Applies to: {targetLabel(request.targets[0])}</p>}

      <div className="actions">
        <button type="button" className="pill pill-primary" disabled={!chosen || busy} onClick={apply}>Apply</button>
        <button type="button" className="pill" disabled={busy} onClick={onClose}>Cancel</button>
        {canUndo && <button type="button" className="pill" disabled={busy} onClick={() => void undo()}>{busy ? "Matching…" : "Match Automatically"}</button>}
      </div>
    </Dialog>
  );
}

function Thumb({ item }: { item: CatalogItem }) {
  const src = image(item.posterPath, "w185");
  return src ? <img className="fix-match-thumb" src={src} alt="" loading="lazy" /> : <span className="fix-match-thumb" aria-hidden="true" />;
}
