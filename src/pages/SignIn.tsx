import { useEffect, useState } from "react";
import { pollDeviceCode, requestDeviceCode } from "../api/putio";
import { hasTMDB } from "../api/tmdb";
import { Logo } from "../components/Icons";
import { useSession } from "../state/session";

const APP_ID = (import.meta.env.VITE_PUTIO_APP_ID as string | undefined) ?? "9877";

/** put.io sign-in with a short code entered at put.io/link (the same as on Apple TV): nothing to set up. */
export function SignIn() {
  const { setPutioToken } = useSession();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pasted, setPasted] = useState("");

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    setCode(null);
    setError(null);
    requestDeviceCode(APP_ID).then(({ code }) => {
      if (!live) return;
      setCode(code);
      const poll = async () => {
        try {
          const token = await pollDeviceCode(code);
          if (!live) return;
          if (token) setPutioToken(token);
          else timer = window.setTimeout(poll, 3000);
        } catch {
          if (live) setError("The code expired. Get a new one.");
        }
      };
      timer = window.setTimeout(poll, 3000);
    }, () => live && setError("Couldn't reach put.io. Check your connection and try again."));
    return () => { live = false; window.clearTimeout(timer); };
  }, [attempt, setPutioToken]);

  return (
    <main className="signin">
      <div className="signin-card">
        <Logo size={56} />
        <h1 className="display-small">Putio &amp; Chill</h1>
        <p className="muted">Pick something, send it to put.io, and watch it here.</p>
        {!hasTMDB && <p className="error-text small">Missing TMDB key: add VITE_TMDB_TOKEN to .env.local and restart.</p>}
        <ol className="signin-steps">
          <li>Open <a href="https://put.io/link" target="_blank" rel="noreferrer">put.io/link</a> (signed in to put.io).</li>
          <li>Enter this code:</li>
        </ol>
        <div className="device-code" aria-live="polite">{code ?? "······"}</div>
        {error ? (
          <button type="button" className="pill pill-primary" onClick={() => setAttempt((a) => a + 1)}>Get a new code</button>
        ) : (
          <p className="muted small">{code ? "Waiting for put.io…" : "Getting a code…"}</p>
        )}
        {error && <p className="error-text small">{error}</p>}
        <details className="signin-token">
          <summary>Use a put.io access token instead</summary>
          <form onSubmit={(e) => { e.preventDefault(); if (pasted.trim()) setPutioToken(pasted.trim()); }}>
            <label className="visually-hidden" htmlFor="token">put.io access token</label>
            <input id="token" className="text-field" type="password" autoComplete="off" placeholder="put.io access token" value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <button type="submit" className="pill" disabled={!pasted.trim()}>Sign in</button>
          </form>
        </details>
      </div>
    </main>
  );
}
