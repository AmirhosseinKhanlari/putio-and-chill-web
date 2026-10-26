import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useNavigate } from "react-router-dom";
import { enabledProviders, releaseKey, searchReleases, sortReleases, sourceNames, type ReleaseSnapshot, type ReleaseSort } from "../api/sources";
import type { Release, ReleaseQuery } from "../api/sources/types";
import { hasTMDB, tmdb } from "../api/tmdb";
import { bytes } from "../lib/format";
import { resolutionLabel } from "../lib/releaseName";
import { noQueryMessage, noVersionsMessage, releaseQuery, type GetTarget } from "../lib/releaseQuery";
import { loadSettings, qualityName, useSettings } from "../lib/settings";
import { badReleases, isBlocked } from "../lib/badReleases";
import { fileRejection } from "../api/sources/fileLists";
import { displayPath, pickCheckedRelease, sendToPutio } from "../lib/smartGet";
import { useToast } from "../state/hooks";
import { useSession } from "../state/session";
import { CloseIcon } from "./Icons";
import "../styles/versions.css";

export type { GetTarget } from "../lib/releaseQuery";

/** YTS looks movies up by IMDb id; callers that only have the TMDB item (Home's hero) get it here, once per movie. */
const imdbIDs = new Map<number, Promise<string | undefined>>();
async function withIMDbID(target: GetTarget): Promise<GetTarget> {
  const { item } = target;
  if (target.imdbID || target.text || item.kind !== "movie" || !item.tmdbID || !hasTMDB) return target;
  if (!imdbIDs.has(item.tmdbID)) imdbIDs.set(item.tmdbID, tmdb.detail("movie", item.tmdbID).then((d) => d.imdbID, () => undefined));
  return { ...target, imdbID: await imdbIDs.get(item.tmdbID) };
}

const label = (t: GetTarget) => (t.episode !== undefined ? `S${t.season} E${t.episode}` : t.season !== undefined ? `Season ${t.season}` : t.item.title);

/** A finished search, with the query it ran (for the "no versions" explanation). */
type SearchResult = ReleaseSnapshot & { query: ReleaseQuery };

/** What the Versions list needs from the page that opened it. */
interface VersionsDeps {
  search: (target: GetTarget, onUpdate: (s: ReleaseSnapshot) => void, signal: AbortSignal) => Promise<SearchResult>;
  send: (target: GetTarget, release: Release) => Promise<void>;
  openSettings: (page: string) => void;
}

/** Get & Watch: searches every source turned on in Settings (chill.institute too, when connected), then either
 * sends the release Smart Get picks to put.io or, with one-tap Get off, opens Versions. */
export function useGetAndWatch() {
  const { putio, chill } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const canGet = Boolean(putio) && enabledProviders(settings, chill).length > 0;

  async function search(target: GetTarget, options: { onUpdate?: (s: ReleaseSnapshot) => void; signal?: AbortSignal } = {}): Promise<SearchResult> {
    const providers = enabledProviders(loadSettings(), chill);
    if (!providers.length) throw new Error("Every source is turned off. Turn one on in Settings → Sources.");
    const query = releaseQuery(await withIMDbID(target));
    if (!query) throw new Error(noQueryMessage(target));
    return { ...(await searchReleases(query, providers, options)), query };
  }

  /** Every release found; throws only when nothing was found because every source failed. */
  async function releases(target: GetTarget): Promise<Release[]> {
    const snapshot = await search(target);
    if (!snapshot.releases.length && snapshot.failures.length) throw new Error(snapshot.failures.map((f) => f.message).join(" "));
    return snapshot.releases;
  }

  async function send(target: GetTarget, release: Release) {
    if (!putio) return;
    const { item, season, episode } = target;
    try {
      await sendToPutio(putio, release, { tmdbID: item.tmdbID, kind: item.kind, title: item.title, season, episode, posterPath: item.posterPath, backdropPath: item.backdropPath });
    } catch (error) {
      toast(error instanceof Error ? error.message : "put.io didn't take it. Try again.");
      throw error;
    }
    const where = target.text ? "" : ` → ${displayPath(loadSettings(), item.kind, item.title, season)}`;
    toast(`Sending ${label(target)} to put.io (${resolutionLabel(release.parsed.resolution) || "unknown quality"})${where}`);
  }

  const deps: VersionsDeps = {
    search: (target, onUpdate, signal) => search(target, { onUpdate, signal }),
    send,
    openSettings: (page) => navigate(`/settings?page=${page}`),
  };

  async function getBest(target: GetTarget) {
    const current = loadSettings();
    if (!current.oneTapGet) { openVersions(target, deps); return; }
    setBusy(true);
    try {
      const snapshot = await search(target);
      const blocked = badReleases();
      const best = await pickCheckedRelease(snapshot.releases, current.smartGet, async (r) => (isBlocked(r, blocked) ? { kind: "knownBad" } : fileRejection(r)));
      if (best) { await send(target, best).catch(() => {}); return; }
      if (snapshot.releases.length) {
        toast(`Nothing fits Smart Get (${qualityName(current.smartGet.resolution)}${current.smartGet.maxSizeGB ? `, up to ${current.smartGet.maxSizeGB} GB` : ""}). Pick a version.`);
        openVersions(target, deps);
      } else {
        toast(snapshot.failures.length === enabledProviders(current, chill).length ? "No source answered. Try again in a minute." : noVersionsMessage(snapshot.query, snapshot.failures));
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't get it right now.");
    } finally {
      setBusy(false);
    }
  }

  return { busy, getBest, releases, search, send, canGet, deps };
}

/** Versions opened by Get & Watch (one-tap Get off). The pages own their own Versions state, so this one gets a
 * small root of its own; it still talks to the page through `deps` (put.io, toasts, navigation). */
function openVersions(target: GetTarget, deps: VersionsDeps) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  const close = () => { root.unmount(); element.remove(); };
  root.render(<StrictMode><VersionsPanel target={target} deps={deps} onClose={close} /></StrictMode>);
}

/** Every version the sources find, each one click to put.io. */
export function VersionsDialog({ target, onClose }: { target: GetTarget; onClose: () => void }) {
  const { deps } = useGetAndWatch();
  return <VersionsPanel target={target} deps={deps} onClose={onClose} />;
}

const sorts: { id: ReleaseSort; name: string }[] = [{ id: "seeders", name: "Most seeders" }, { id: "quality", name: "Best quality" }, { id: "size", name: "Largest" }];

function VersionsPanel({ target, deps, onClose }: { target: GetTarget; deps: VersionsDeps; onClose: () => void }) {
  const settings = useSettings();
  const [snapshot, setSnapshot] = useState<ReleaseSnapshot>({ releases: [], failures: [], pending: [] });
  // Known once the search ends (a movie's IMDb id may be looked up first).
  const [query, setQuery] = useState<ReleaseQuery>();
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string>();
  const [resolution, setResolution] = useState<number | null>(settings.defaultResolution);
  const [sort, setSort] = useState<ReleaseSort>("seeders");
  const [sending, setSending] = useState<string>();
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    deps.search(target, (s) => { setStarted(true); setSnapshot(s); }, controller.signal)
      .then((result) => setQuery(result.query))
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Search failed."); });
    return () => controller.abort();
    // One search per opened dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const resolutions = useMemo(() => {
    const found = new Set<number>(snapshot.releases.map((r) => r.parsed.resolution).filter((r) => r > 0));
    if (resolution !== null) found.add(resolution);
    return [...found].sort((a, b) => b - a);
  }, [snapshot.releases, resolution]);
  const count = (r: number) => snapshot.releases.filter((x) => x.parsed.resolution === r).length;
  const rows = useMemo(
    () => sortReleases(resolution === null ? snapshot.releases : snapshot.releases.filter((r) => r.parsed.resolution === resolution), sort),
    [snapshot.releases, resolution, sort],
  );

  const searching = !error && (!started || snapshot.pending.length > 0 || Boolean(snapshot.checkingFiles));
  const allFailed = !searching && !snapshot.releases.length && snapshot.failures.length > 0;
  const heading = target.text ? `“${target.text}”` : target.episode !== undefined ? `${target.item.title} · S${target.season} E${target.episode}` : target.season !== undefined ? `${target.item.title} · Season ${target.season}` : target.item.title;

  async function get(release: Release) {
    setSending(releaseKey(release));
    try {
      await deps.send(target, release);
      onClose();
    } catch {
      setSending(undefined);
    }
  }

  const settingsLink = (page: string, text: string) => (
    <a href={`/settings?page=${page}`} onClick={(e) => { e.preventDefault(); onClose(); deps.openSettings(page); }}>{text}</a>
  );

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="dialog versions-dialog" role="dialog" aria-modal="true" aria-label={`Versions of ${heading}`} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div>
            <div className="eyebrow">CHOOSE A VERSION</div>
            <h2>{heading}</h2>
          </div>
          <button ref={closeButton} type="button" className="icon-button" aria-label="Close" onClick={onClose}><CloseIcon /></button>
        </div>

        <div className="versions-controls">
          <div className="chips versions-chips" role="group" aria-label="Quality">
            <button type="button" className="chip" aria-pressed={resolution === null} onClick={() => setResolution(null)}>All{snapshot.releases.length ? ` · ${snapshot.releases.length}` : ""}</button>
            {resolutions.map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={resolution === r} onClick={() => setResolution(r)}>{qualityName(r)} · {count(r)}</button>
            ))}
          </div>
          <label className="versions-sort">
            <span className="visually-hidden">Sort versions</span>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as ReleaseSort)}>
              {sorts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>

        <div className="versions-status muted small" role="status" aria-live="polite">
          {searching && <span>{snapshot.checkingFiles ? "Checking files…" : `Searching ${snapshot.pending.length ? snapshot.pending.map((id) => sourceNames[id]).join(", ") : "every source"}…`}</span>}
          {!searching && (snapshot.hidden ?? 0) > 0 && <span>{snapshot.hidden === 1 ? "1 version that looks fake is hidden." : `${snapshot.hidden} versions that look fake are hidden.`} </span>}
          {!searching && snapshot.failures.length > 0 && !allFailed && <span>{snapshot.failures.map((f) => f.message).join(" ")}</span>}
        </div>

        {error && <p className="error-text">{error} {settingsLink("sources", "Open Settings")}</p>}
        {allFailed && <p className="error-text">{snapshot.failures.map((f) => f.message).join(" ")} {settingsLink("sources", "Check sources")}</p>}
        {!searching && !error && !allFailed && !snapshot.releases.length && <p className="muted">{noVersionsMessage(query)}</p>}
        {!searching && resolution !== null && snapshot.releases.length > 0 && !rows.length && (
          <p className="muted">None in {qualityName(resolution)} yet. <button type="button" className="link-button" onClick={() => setResolution(null)}>Show all</button></p>
        )}

        <ul className="versions">
          {rows.map((r) => {
            const key = releaseKey(r);
            return (
              <li key={key}>
                <div className="version-main">
                  <div className="version-tags">
                    {resolutionLabel(r.parsed.resolution) && <span className="tag tag-strong">{resolutionLabel(r.parsed.resolution)}</span>}
                    {r.parsed.source && <span className="tag">{r.parsed.source}</span>}
                    {r.parsed.codec && <span className="tag">{r.parsed.codec}</span>}
                    {r.parsed.hdr.map((h) => <span key={h} className="tag">{h}</span>)}
                    {r.parsed.audio && <span className="tag">{r.parsed.audio}</span>}
                  </div>
                  <div className="version-name">{r.name}</div>
                  <div className="version-meta small">
                    {r.sizeBytes !== undefined && <span>{bytes(r.sizeBytes)}</span>}
                    {r.seeders !== undefined && <span className={r.seeders > 0 ? "version-seeders" : "version-dead"}>{r.seeders} seeders</span>}
                    {r.sources.map((s) => <span key={s} className="version-source">{s}</span>)}
                  </div>
                </div>
                <button type="button" className="pill pill-primary pill-small" disabled={sending !== undefined} aria-label={`Get ${r.name}`} onClick={() => void get(r)}>
                  {sending === key ? "Sending…" : "Get"}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
