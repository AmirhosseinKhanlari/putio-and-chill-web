import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Release, ReleaseQuery } from "../api/chill";
import type { CatalogItem } from "../api/tmdb";
import { bytes } from "../lib/format";
import { resolutionLabel } from "../lib/releaseName";
import { loadSettings, pickRelease, sendToPutio } from "../lib/smartGet";
import { useToast } from "../state/hooks";
import { useSession } from "../state/session";
import { CloseIcon } from "./Icons";

export interface GetTarget {
  item: CatalogItem;
  imdbID?: string;
  season?: number;
  episode?: number;
  /** Free text from Search ("Search releases for …"): every release that matches, not one title. */
  text?: string;
}

export function releaseQuery(t: GetTarget): ReleaseQuery | undefined {
  if (t.text) return { kind: "text", text: t.text };
  if (t.item.kind === "movie") return { kind: "movie", title: t.item.title, year: t.item.year };
  if (!t.imdbID || t.season === undefined) return undefined;
  return t.episode !== undefined ? { kind: "episode", imdbID: t.imdbID, season: t.season, episode: t.episode } : { kind: "season", imdbID: t.imdbID, season: t.season };
}

/** Get & Watch: find releases on chill.institute, pick the best and send it to put.io. */
export function useGetAndWatch() {
  const { putio, chill } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function releases(target: GetTarget): Promise<Release[]> {
    if (!chill) throw new Error("Connect chill.institute in Settings to get movies and shows.");
    const query = releaseQuery(target);
    if (!query) throw new Error("This show has no IMDb id yet, so it can't be searched.");
    return chill.releases(query);
  }

  async function send(target: GetTarget, release: Release) {
    if (!putio) return;
    await sendToPutio(putio, release, {
      tmdbID: target.item.tmdbID, kind: target.item.kind, title: target.item.title, season: target.season, episode: target.episode,
      posterPath: target.item.posterPath, backdropPath: target.item.backdropPath,
    });
    const what = target.episode !== undefined ? `S${target.season} E${target.episode}` : target.season !== undefined ? `Season ${target.season}` : target.item.title;
    toast(`Sending ${what} to put.io (${resolutionLabel(release.parsed.resolution) || "best quality"})`);
  }

  async function getBest(target: GetTarget) {
    setBusy(true);
    try {
      const found = await releases(target);
      const best = pickRelease(found, loadSettings().resolution);
      if (!best) { toast("No versions found. Try Versions to search more widely."); return; }
      await send(target, best);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't get it right now.");
    } finally {
      setBusy(false);
    }
  }

  return { busy, getBest, releases, send, canGet: Boolean(chill) };
}

/** Every version chill.institute finds, best first, each one-click to put.io. */
export function VersionsDialog({ target, onClose }: { target: GetTarget; onClose: () => void }) {
  const get = useGetAndWatch();
  const [state, setState] = useState<{ loading: boolean; list: Release[]; error?: string }>({ loading: true, list: [] });
  const { releases } = get;
  useEffect(() => {
    let live = true;
    releases(target)
      .then((list) => live && setState({ loading: false, list: [...list].sort((a, b) => (b.parsed.resolution - a.parsed.resolution) || ((b.seeders ?? 0) - (a.seeders ?? 0))) }))
      .catch((error) => live && setState({ loading: false, list: [], error: error instanceof Error ? error.message : "Search failed." }));
    return () => { live = false; };
    // One search per opened dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const heading = target.episode !== undefined ? `${target.item.title} · S${target.season} E${target.episode}` : target.season !== undefined ? `${target.item.title} · Season ${target.season}` : target.item.title;
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={`Versions of ${heading}`} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div>
            <div className="eyebrow">CHOOSE A VERSION</div>
            <h2>{heading}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><CloseIcon /></button>
        </div>
        {state.loading && <p className="muted">Searching…</p>}
        {state.error && <p className="error-text">{state.error}{!get.canGet && <> <Link to="/settings">Open Settings</Link></>}</p>}
        {!state.loading && !state.error && !state.list.length && <p className="muted">No versions found.</p>}
        <ul className="versions">
          {state.list.map((r) => (
            <li key={r.link}>
              <div className="version-main">
                <div className="version-tags">
                  {resolutionLabel(r.parsed.resolution) && <span className="tag tag-strong">{resolutionLabel(r.parsed.resolution)}</span>}
                  {r.parsed.source && <span className="tag">{r.parsed.source}</span>}
                  {r.parsed.codec && <span className="tag">{r.parsed.codec}</span>}
                  {r.parsed.hdr.map((h) => <span key={h} className="tag">{h}</span>)}
                </div>
                <div className="version-name">{r.name}</div>
                <div className="muted small">{[bytes(r.sizeBytes), r.seeders !== undefined ? `${r.seeders} seeders` : undefined, r.source].filter(Boolean).join(" · ")}</div>
              </div>
              <button type="button" className="pill pill-primary" onClick={() => { void get.send(target, r).then(onClose, () => {}); }}>Get</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
