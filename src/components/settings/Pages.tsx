/** Settings' pages (the iPhone app's Settings, minus what only a device can do). Changes apply right away. */
import { useState } from "react";
import { chillSignInURL } from "../../api/chill";
import { parseIMDbRef } from "../../api/lists/imdb";
import { sourceNames } from "../../api/sources";
import { hasTMDB } from "../../api/tmdb";
import { languages, qualityName, updateSettings, useSettings, type AppSettings, type SourceConfig } from "../../lib/settings";
import { defaultMoviesPath, defaultTVPath, displayPath } from "../../lib/smartGet";
import { refreshLibrary, useLibrary } from "../../state/hooks";
import { useSession } from "../../state/session";
import { Group, Row, SaveField, SelectRow, ToggleRow, type Option } from "./Controls";
import { FolderPicker } from "./FolderPicker";
import { SubtitleStyleEditor } from "./SubtitleStyleEditor";

const languageOptions = (none: string): Option<string | null>[] => [{ value: null, label: none }, ...languages.map((l) => ({ value: l.code, label: l.name }))];
const resolutionOptions = (none: string, list = [4320, 2160, 1080, 720, 480]): Option<number | null>[] => [{ value: null, label: none }, ...list.map((r) => ({ value: r, label: qualityName(r) }))];

export function PlaybackPage() {
  const s = useSettings();
  return (
    <Group footer="When ready: a video you asked for with Get & Watch starts playing, after a short countdown, once put.io has it. Next episode: a countdown at the end credits, then the next episode plays.">
      <ToggleRow label="Auto-play when ready" checked={s.autoPlayCountdown} onChange={(autoPlayCountdown) => updateSettings({ autoPlayCountdown })} />
      <ToggleRow label="Auto-play next episode" checked={s.autoPlayNextEpisode} onChange={(autoPlayNextEpisode) => updateSettings({ autoPlayNextEpisode })} />
      <SelectRow label="Audio language" description="Picked when the video has this track." value={s.audioLanguage} options={languageOptions("Original")} onChange={(audioLanguage) => updateSettings({ audioLanguage })} />
    </Group>
  );
}

export function SubtitlesPage() {
  const s = useSettings();
  return (
    <>
      <Group footer="Subtitles turn on in this language when put.io (or OpenSubtitles) has them. The subtitles button in the player lists every track.">
        <SelectRow label="Language" value={s.subtitleLanguage} options={languageOptions("Off")} onChange={(subtitleLanguage) => updateSettings({ subtitleLanguage })} />
      </Group>
      <SubtitleStyleEditor style={s.subtitleStyle} onChange={(subtitleStyle) => updateSettings({ subtitleStyle })} />
      <Group title="OpenSubtitles" footer="In the player, the subtitles button searches OpenSubtitles when put.io's subtitles are missing or out of sync. Get a free API key at opensubtitles.com → API consumers. The key stays in this browser.">
        {s.openSubtitlesKey ? (
          <Row label="API key" description="Saved">
            <button type="button" className="pill pill-small pill-danger" onClick={() => updateSettings({ openSubtitlesKey: null })}>Remove</button>
          </Row>
        ) : (
          <SaveField label="OpenSubtitles API key" type="password" onSave={(openSubtitlesKey) => updateSettings({ openSubtitlesKey })} />
        )}
      </Group>
    </>
  );
}

const sizeOptions: Option<number | null>[] = [
  { value: 2, label: "2 GB" }, { value: 5, label: "5 GB" }, { value: 10, label: "10 GB" }, { value: 20, label: "20 GB" }, { value: 40, label: "40 GB" }, { value: null, label: "No limit" },
];

export function SmartGetPage() {
  const s = useSettings();
  const rule = s.smartGet;
  return (
    <>
      <Group footer={s.oneTapGet
        ? "Get & Watch sends the release with the most seeders in this quality; when there's none, the nearest lower quality, then higher. Never a camera copy, never one bigger than the size limit, never one nobody seeds."
        : "Get & Watch opens Versions, so you pick the release yourself."}>
        <ToggleRow label="One-tap Get" description="Off: Get & Watch always opens Versions." checked={s.oneTapGet} onChange={(oneTapGet) => updateSettings({ oneTapGet })} />
        <SelectRow label="Quality" value={rule.resolution} options={resolutionOptions("Best there is")} disabled={!s.oneTapGet} onChange={(resolution) => updateSettings({ smartGet: { ...rule, resolution } })} />
        <SelectRow label="Max size" value={rule.maxSizeGB} options={sizeOptions} disabled={!s.oneTapGet} onChange={(maxSizeGB) => updateSettings({ smartGet: { ...rule, maxSizeGB } })} />
      </Group>
      <Group title="Versions" footer="The quality Versions shows first. The others are one tap away.">
        <SelectRow label="Versions list shows" value={s.defaultResolution} options={resolutionOptions("All")} onChange={(defaultResolution) => updateSettings({ defaultResolution })} />
      </Group>
    </>
  );
}

const sourceAbout: Record<SourceConfig["id"], string> = {
  chill: "The indexers you use on chill.institute.",
  yts: "Movies: small, good-quality encodes.",
  eztv: "TV episodes and season packs.",
  apibay: "Movies and TV. Through this site's proxy.",
  knaben: "Searches many trackers at once. Through this site's proxy.",
  torrentscsv: "Movies and TV from a public torrent index.",
};

export function SourcesPage() {
  const s = useSettings();
  const { chill } = useSession();
  const toggle = (id: SourceConfig["id"], enabled: boolean) => updateSettings((c: AppSettings) => ({ ...c, sources: c.sources.map((x) => (x.id === id ? { ...x, enabled } : x)) }));
  return (
    <Group footer="Get & Watch and Versions ask every source that's on at the same time and show the same torrent found on several as one, with the most seeders any of them reports. A source that doesn't answer in 12 seconds is skipped.">
      {s.sources.map((src) => (
        <ToggleRow key={src.id} label={src.id === "apibay" ? "The Pirate Bay (apibay)" : sourceNames[src.id]} checked={src.enabled} onChange={(on) => toggle(src.id, on)}
          description={src.id === "chill" && !chill ? `${sourceAbout.chill} Not connected: connect it in Connected Services.` : sourceAbout[src.id]} />
      ))}
    </Group>
  );
}

const intervalOptions: Option<number>[] = [
  { value: 15, label: "15 minutes" }, { value: 30, label: "30 minutes" }, { value: 60, label: "Hour" }, { value: 360, label: "6 hours" }, { value: 1440, label: "Day" },
];

function ago(time: number): string {
  if (!time) return "Never";
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(time).toLocaleDateString();
}

export function LibraryPage() {
  const s = useSettings();
  const lib = useLibrary();
  const { putio } = useSession();
  const [status, setStatus] = useState<string>();
  async function updateNow() {
    if (!putio) return;
    const before = lib.entries.length;
    setStatus(undefined);
    await refreshLibrary(putio);
    const added = lib.entries.length - before;
    setStatus(added > 0 ? `Updated · ${added} new` : "Up to date");
  }
  return (
    <>
      <Group footer="Your put.io library is kept in this browser so the app opens instantly. With automatic updates on, it checks put.io at this interval while the app is open.">
        <ToggleRow label="Update automatically" checked={s.libraryAutoUpdate} onChange={(libraryAutoUpdate) => updateSettings({ libraryAutoUpdate })} />
        {s.libraryAutoUpdate && (
          <SelectRow label="Check put.io every" value={s.libraryUpdateMinutes} options={intervalOptions} onChange={(libraryUpdateMinutes) => updateSettings({ libraryUpdateMinutes })} />
        )}
      </Group>
      <Group>
        <Row label="Videos" description={lib.isRefreshing ? lib.progressText : undefined}><span className="muted">{lib.entries.length}</span></Row>
        <Row label="Last updated"><span className="muted" aria-live="polite">{lib.isRefreshing ? "Updating…" : status ?? ago(lib.updatedAt)}</span></Row>
        <Row label="Update now" description="Reads every folder in put.io again.">
          <button type="button" className="pill pill-small" disabled={lib.isRefreshing || !putio} onClick={() => void updateNow()}>{lib.isRefreshing ? "Updating…" : "Update Now"}</button>
        </Row>
      </Group>
    </>
  );
}

export function FoldersPage() {
  const s = useSettings();
  const [picking, setPicking] = useState<"movies" | "tv" | null>(null);
  if (picking === "movies") {
    return <FolderPicker title="Movies Folder" defaultPath={defaultMoviesPath.join("/")} selection={s.moviesFolder} onPick={(moviesFolder) => updateSettings({ moviesFolder })} onDone={() => setPicking(null)} />;
  }
  if (picking === "tv") {
    return <FolderPicker title="TV Folder" defaultPath={defaultTVPath.join("/")} selection={s.tvFolder} onPick={(tvFolder) => updateSettings({ tvFolder })} onDone={() => setPicking(null)} />;
  }
  const custom = s.moviesFolder !== null || s.tvFolder !== null;
  return (
    <>
      <Group footer={`New downloads go to ${displayPath(s, "movie", "")} and ${displayPath(s, "tv", "Show", 1)}.`}>
        <Row label="Movies" description={s.moviesFolder?.path ?? defaultMoviesPath.join("/")}>
          <button type="button" className="pill pill-small" aria-label="Change the movies folder" onClick={() => setPicking("movies")}>Change</button>
        </Row>
        <Row label="TV shows" description={s.tvFolder?.path ?? defaultTVPath.join("/")}>
          <button type="button" className="pill pill-small" aria-label="Change the TV folder" onClick={() => setPicking("tv")}>Change</button>
        </Row>
        <ToggleRow label="Season folders" description="Episodes go into “Season N” inside the show's folder." checked={s.seasonFolders} onChange={(seasonFolders) => updateSettings({ seasonFolders })} />
      </Group>
      {custom && (
        <Group footer="Files already in put.io stay where they are.">
          <Row label="Use the default folders" description="AMDB/Movies and AMDB/TV, as in the iPhone app.">
            <button type="button" className="pill pill-small" onClick={() => updateSettings({ moviesFolder: null, tvFolder: null })}>Reset</button>
          </Row>
        </Group>
      )}
    </>
  );
}

export function ServicesPage() {
  const s = useSettings();
  const session = useSession();
  const [imdbProblem, setIMDbProblem] = useState<string>();
  // chill.institute signs in through put.io and comes back here with the token in the address.
  const chillURL = chillSignInURL(`${window.location.origin}/settings?page=services`);
  return (
    <>
      <Group title="Releases" footer="chill.institute is one of the sources Get & Watch and Versions search. Everything works without it; connect it to add the indexers you use there.">
        <Row label="chill.institute" description={session.chill ? "Connected" : "Not connected"}>
          {session.chill
            ? <button type="button" className="pill pill-small pill-danger" onClick={() => session.setChillToken(null)}>Disconnect</button>
            : <a className="pill pill-small pill-primary" href={chillURL}>Connect</a>}
        </Row>
        {!session.chill && <SaveField label="chill.institute token" placeholder="…or paste your chill.institute token" type="password" onSave={(token) => session.setChillToken(token)} />}
      </Group>

      <Group title="IMDb" footer="Your IMDb watchlist shows on Home. Paste the link to your watchlist or profile (IMDb app: Watchlist → Share → Copy link). It must be public: on imdb.com, Watchlist → Edit → Privacy → Public. The app only reads it.">
        {s.imdbWatchlist ? (
          <Row label="IMDb watchlist" description={s.imdbWatchlist}>
            <button type="button" className="pill pill-small pill-danger" onClick={() => updateSettings({ imdbWatchlist: null })}>Disconnect</button>
          </Row>
        ) : (
          <SaveField label="IMDb profile or watchlist link" type="url" onSave={(text) => {
            // The same reading Home uses: a watchlist, list or profile link, or a bare ur…/ls… id.
            const ok = Boolean(parseIMDbRef(text));
            setIMDbProblem(ok ? undefined : "That isn't an IMDb watchlist, list or profile link.");
            if (!ok) return false;
            updateSettings({ imdbWatchlist: text });
          }} />
        )}
        {imdbProblem && <div className="settings-item error-text small" role="alert">{imdbProblem}</div>}
      </Group>

      <Group title="Catalog and subtitles">
        <Row label="TMDB" description="Titles, artwork, cast and recommendations."><span className="muted">{hasTMDB ? "Built in" : "Missing"}</span></Row>
        <Row label="OpenSubtitles" description="Set the API key in Subtitles."><span className="muted">{s.openSubtitlesKey ? "Connected" : "Not connected"}</span></Row>
      </Group>
    </>
  );
}

export function AboutPage() {
  return (
    <Group>
      <div className="settings-item settings-prose">
        <p><span className="strong">Putio & Chill</span> for the web: pick a movie or show, send it to put.io, and watch it in the browser.</p>
        <p className="muted small">Movie and show data from TMDB. Releases from the sources turned on in Settings → Sources; YTS, EZTV, Torrents.csv and chill.institute are asked directly, The Pirate Bay and Knaben through this site's small proxy (it only reaches those services). Videos stream from your put.io.</p>
        <p className="muted small">Your put.io and chill.institute sign-ins, API keys and settings are kept only in this browser.</p>
      </div>
    </Group>
  );
}
