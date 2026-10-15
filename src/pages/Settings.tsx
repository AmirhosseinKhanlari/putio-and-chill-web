import { useState } from "react";
import { chillSignInURL } from "../api/chill";
import { TopBar } from "../components/TopBar";
import { bytes } from "../lib/format";
import { updateSettings, useSettings } from "../lib/settings";
import { refreshLibrary, useAccount, useLibrary } from "../state/hooks";
import { useSession } from "../state/session";

const qualities = [4320, 2160, 1080, 720, 480];
const qualityName = (r: number) => (r === 4320 ? "8K" : r === 2160 ? "4K" : `${r}p`);

export function Settings() {
  const session = useSession();
  const account = useAccount().data;
  const lib = useLibrary();
  const settings = useSettings();
  const [pasted, setPasted] = useState("");
  // chill.institute signs in through put.io and comes back here with the token.
  const chillURL = chillSignInURL(`${window.location.origin}/settings`);

  return (
    <div className="page">
      <TopBar back />
      <div className="page-body narrow settings">
        <h1 className="display-small">Settings</h1>

        <section className="settings-group" aria-labelledby="s-account">
          <h2 id="s-account">put.io</h2>
          <div className="settings-row">
            <div>
              <div className="strong">{account?.username ?? "Signed in"}</div>
              {account?.disk && <div className="muted small">{bytes(account.disk.used)} of {bytes(account.disk.size)} used · {bytes(account.disk.avail)} free</div>}
            </div>
            <button type="button" className="pill pill-danger" onClick={session.signOut}>Sign Out</button>
          </div>
          <div className="settings-row">
            <div>
              <div className="strong">Library</div>
              <div className="muted small">{lib.entries.length} videos{lib.isRefreshing ? ` · ${lib.progressText}` : ""}</div>
            </div>
            <button type="button" className="pill" disabled={lib.isRefreshing || !session.putio} onClick={() => session.putio && void refreshLibrary(session.putio)}>Update Now</button>
          </div>
        </section>

        <section className="settings-group" aria-labelledby="s-get">
          <h2 id="s-get">Smart Get</h2>
          <div className="settings-row">
            <div>
              <label className="strong" htmlFor="quality">Quality</label>
              <div className="muted small">Get & Watch picks this quality with the most seeders; lower first when it's missing.</div>
            </div>
            <select id="quality" className="select" value={settings.smartGet.resolution ?? 4320} onChange={(e) => updateSettings({ smartGet: { ...settings.smartGet, resolution: Number(e.target.value) } })}>
              {qualities.map((q) => <option key={q} value={q}>{qualityName(q)}</option>)}
            </select>
          </div>
          <div className="settings-row">
            <div>
              <div className="strong">chill.institute</div>
              <div className="muted small">{session.chill ? "Connected: Get & Watch and Versions search it." : "Connect it to get movies and shows into put.io."}</div>
            </div>
            {session.chill ? (
              <button type="button" className="pill pill-danger" onClick={() => session.setChillToken(null)}>Disconnect</button>
            ) : (
              <a className="pill pill-primary" href={chillURL}>Connect</a>
            )}
          </div>
          {!session.chill && (
            <form className="settings-row" onSubmit={(e) => { e.preventDefault(); if (pasted.trim()) session.setChillToken(pasted.trim()); }}>
              <label className="visually-hidden" htmlFor="chill-token">chill.institute token</label>
              <input id="chill-token" className="text-field" type="password" autoComplete="off" placeholder="…or paste your chill.institute token" value={pasted} onChange={(e) => setPasted(e.target.value)} />
              <button type="submit" className="pill" disabled={!pasted.trim()}>Save</button>
            </form>
          )}
        </section>

        <section className="settings-group" aria-labelledby="s-about">
          <h2 id="s-about">About</h2>
          <p className="muted small">Movie and show data from TMDB. Videos stream from your put.io. This app stores your sign-in only in this browser.</p>
        </section>
      </div>
    </div>
  );
}
