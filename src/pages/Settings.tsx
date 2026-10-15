/** Settings: a hub of pages, like the iPhone app's (account card, then Playback, Smart Get, Library, services).
 * The open page is in the address (?page=…), so Back returns to the hub. */
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Group, NavRow, glyphs } from "../components/settings/Controls";
import { AboutPage, FoldersPage, LibraryPage, PlaybackPage, ServicesPage, SmartGetPage, SourcesPage, SubtitlesPage } from "../components/settings/Pages";
import { TopBar } from "../components/TopBar";
import { bytes } from "../lib/format";
import { languageName, qualityName, useSettings } from "../lib/settings";
import { useAccount } from "../state/hooks";
import { useSession } from "../state/session";

const pages: Record<string, { title: string; render: () => ReactNode }> = {
  playback: { title: "Playback", render: () => <PlaybackPage /> },
  subtitles: { title: "Subtitles", render: () => <SubtitlesPage /> },
  "smart-get": { title: "Smart Get", render: () => <SmartGetPage /> },
  sources: { title: "Sources", render: () => <SourcesPage /> },
  library: { title: "Library", render: () => <LibraryPage /> },
  folders: { title: "put.io Folders", render: () => <FoldersPage /> },
  services: { title: "Connected Services", render: () => <ServicesPage /> },
  about: { title: "About", render: () => <AboutPage /> },
};

export function Settings() {
  const [params] = useSearchParams();
  const page = pages[params.get("page") ?? ""];
  return (
    <div className="page">
      <TopBar back />
      <div className="page-body narrow settings">
        {page ? (
          <>
            <div className="settings-page-head">
              <Link to="/settings" className="settings-up small">Settings</Link>
              <h1 className="settings-title">{page.title}</h1>
            </div>
            {page.render()}
          </>
        ) : (
          <Hub />
        )}
      </div>
    </div>
  );
}

function Hub() {
  const s = useSettings();
  const session = useSession();
  const enabled = s.sources.filter((x) => x.enabled && (x.id !== "chill" || session.chill)).length;
  const smartGet = s.oneTapGet ? [qualityName(s.smartGet.resolution), s.smartGet.maxSizeGB ? `≤ ${s.smartGet.maxSizeGB} GB` : ""].filter(Boolean).join(" · ") : "Off";
  const connected = [Boolean(session.chill), Boolean(s.imdbWatchlist), Boolean(s.openSubtitlesKey)].filter(Boolean).length;
  return (
    <>
      <h1 className="display-small">Settings</h1>
      <AccountCard />
      <Group>
        <NavRow page="playback" icon={glyphs.play} color="#3b82f6" label="Playback" value={s.autoPlayNextEpisode ? "Auto-play on" : "Auto-play off"} />
        <NavRow page="subtitles" icon={glyphs.captions} color="#f97316" label="Subtitles" value={languageName(s.subtitleLanguage) ?? "Off"} />
      </Group>
      <Group>
        <NavRow page="smart-get" icon={glyphs.bolt} color="#eab308" label="Smart Get" value={smartGet} />
        <NavRow page="sources" icon={glyphs.antenna} color="#a855f7" label="Sources" value={`${enabled} on`} />
      </Group>
      <Group>
        <NavRow page="library" icon={glyphs.stack} color="#14b8a6" label="Library" value={s.libraryAutoUpdate ? "Updates automatically" : "Manual"} />
        <NavRow page="folders" icon={glyphs.folder} color="#06b6d4" label="put.io Folders" value={s.moviesFolder || s.tvFolder ? "Custom" : "Default"} />
      </Group>
      <Group>
        <NavRow page="services" icon={glyphs.link} color="#22c55e" label="Connected Services" value={`${connected} connected`} />
        <NavRow page="about" icon={glyphs.info} color="#6b7280" label="About" />
      </Group>
    </>
  );
}

/** put.io account: who, how much space, sign out (asks first). */
function AccountCard() {
  const session = useSession();
  const account = useAccount().data;
  const [confirming, setConfirming] = useState(false);
  const name = account?.username ?? "put.io";
  const disk = account?.disk;
  const used = disk && disk.size ? Math.min(1, disk.used / disk.size) : 0;
  return (
    <section className="settings-account" aria-label="put.io account">
      <div className="settings-account-row">
        <span className="settings-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <div className="settings-text">
          <span className="settings-account-name">{name}</span>
          <span className="muted small">put.io account{account?.mail ? ` · ${account.mail}` : ""}</span>
        </div>
        {!confirming && <button type="button" className="pill pill-small pill-danger" onClick={() => setConfirming(true)}>Sign Out</button>}
      </div>
      {disk && (
        <div className="stack-small">
          <div className="settings-meter" role="meter" aria-label="put.io storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)}>
            <span style={{ width: `${used * 100}%`, background: used > 0.9 ? "var(--poor)" : "var(--good)" }} />
          </div>
          <span className="muted small">{bytes(disk.used)} of {bytes(disk.size)} used · {bytes(disk.avail)} free</span>
        </div>
      )}
      {confirming && (
        <div className="settings-confirm" role="alertdialog" aria-label="Sign out of put.io?">
          <span>Sign out of put.io? This browser forgets your library and sign-ins.</span>
          <div className="chips">
            <button type="button" className="pill pill-small" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="pill pill-small pill-danger" onClick={session.signOut}>Sign Out</button>
          </div>
        </div>
      )}
    </section>
  );
}
