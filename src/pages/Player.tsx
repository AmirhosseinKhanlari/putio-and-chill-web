import { useQuery } from "@tanstack/react-query";
import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { PutioSubtitle } from "../api/putio";
import { defaultCaption, playPath, titlePath } from "../components/Cards";
import { Back10, CloseIcon, Forward10, FullscreenIcon, InfoIcon, PauseIcon, PipIcon, PlayIcon, SubtitlesIcon } from "../components/Icons";
import { clock } from "../lib/format";
import { library, type LibraryEntry } from "../lib/library";
import { entryItem, useLibrary } from "../state/hooks";
import { usePutio } from "../state/session";

const SAVE_EVERY = 10;

/** The next episode in put.io: the same season's next one, else the next season's first. */
function nextEpisode(entries: LibraryEntry[], current?: LibraryEntry): LibraryEntry | undefined {
  const m = current?.match;
  if (!m || m.kind !== "tv" || m.season === undefined || m.episode === undefined) return undefined;
  const show = entries.filter((e) => e.match?.tmdbID === m.tmdbID && e.match.season !== undefined && e.match.episode !== undefined);
  return show.find((e) => e.match!.season === m.season && e.match!.episode === m.episode! + 1)
    ?? show.filter((e) => e.match!.season === m.season! + 1).sort((a, b) => a.match!.episode! - b.match!.episode!)[0];
}

export function Player() {
  const { fileID } = useParams();
  const id = Number(fileID);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const putio = usePutio();
  const lib = useLibrary();
  const entry = lib.entries.find((e) => e.id === id);
  const file = useQuery({ queryKey: ["file", id], queryFn: () => putio.file(id), staleTime: 0 });
  const subtitles = useQuery({ queryKey: ["subtitles", id], queryFn: () => putio.subtitles(id), staleTime: 60 * 60_000 });

  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const lastSaved = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subtitleMenu, setSubtitleMenu] = useState(false);
  const [subtitleKey, setSubtitleKey] = useState<string | null>(null);
  const [subtitleURL, setSubtitleURL] = useState<string | null>(null);
  const [resumedFrom, setResumedFrom] = useState(0);
  const next = nextEpisode(lib.entries, entry);
  const item = entry ? entryItem(entry) : undefined;
  const title = entry ? (entry.match?.title ?? entry.name) : file.data?.name ?? "";
  const subtitle = entry?.match?.kind === "tv" ? defaultCaption(entry).replace(`${entry.match.title} · `, "") : entry?.match?.year ? String(entry.match.year) : "";

  // Start: put.io's stream from where you left off (or ?from=0 to start over).
  const startAt = params.get("from") !== null ? Number(params.get("from")) : entry ? lib.resumeSeconds(entry) : file.data?.start_from ?? 0;
  const ready = Boolean(entry || file.data);
  useEffect(() => {
    const el = video.current;
    if (!el || !ready) return;
    const src = putio.hlsURL(id);
    const resumeAt = startAt >= 30 ? startAt : 0;
    setResumedFrom(resumeAt);
    lastSaved.current = resumeAt;
    let hls: Hls | undefined;
    const seekAndPlay = () => {
      if (resumeAt) el.currentTime = resumeAt;
      el.play().catch(() => setChrome(true));
    };
    if (Hls.isSupported()) {
      hls = new Hls({ startPosition: resumeAt || -1 });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError(data.type === Hls.ErrorTypes.NETWORK_ERROR ? "put.io couldn't stream this video right now." : "This video can't play in the browser.");
      });
      hls.loadSource(src);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, () => el.play().catch(() => setChrome(true)));
    } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = src; // Safari plays HLS itself.
      el.addEventListener("loadedmetadata", seekAndPlay, { once: true });
    } else {
      setError("This browser can't play put.io streams.");
    }
    return () => { hls?.destroy(); };
    // Restart only for another file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ready]);

  // Saving the position to put.io (and how long the video is, for the watched bars).
  const save = useCallback((force = false) => {
    const el = video.current;
    if (!el || !el.duration || !Number.isFinite(el.duration)) return;
    const position = Math.floor(el.currentTime);
    if (!force && Math.abs(position - lastSaved.current) < SAVE_EVERY) return;
    lastSaved.current = position;
    const finished = position >= el.duration * 0.95;
    const value = finished ? 0 : position;
    library.noteProgress(id, value, el.duration);
    putio.setStartFrom(id, value).catch(() => {});
  }, [id, putio]);

  useEffect(() => {
    const onHide = () => save(true);
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("pagehide", onHide); save(true); };
  }, [save]);

  // Subtitles: put.io's tracks as WebVTT.
  useEffect(() => {
    let url: string | null = null;
    if (!subtitleKey) { setSubtitleURL(null); return; }
    putio.subtitleVTT(id, subtitleKey).then((text) => {
      url = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
      setSubtitleURL(url);
    }, () => setSubtitleURL(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [id, subtitleKey, putio]);
  useEffect(() => {
    const track = video.current?.textTracks[0];
    if (track) track.mode = subtitleURL ? "showing" : "disabled";
  }, [subtitleURL]);

  // Controls hide while playing and the mouse is still.
  const hideTimer = useRef<number>();
  const poke = useCallback(() => {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => { if (!video.current?.paused) setChrome(false); }, 3000);
  }, []);

  const toggle = useCallback(() => {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play(); else el.pause();
    poke();
  }, [poke]);
  const skip = useCallback((seconds: number) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min((el.duration || 0) - 1, el.currentTime + seconds));
    poke();
  }, [poke]);
  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen();
  }, []);
  const close = useCallback(() => {
    save(true);
    if (window.history.length > 1) navigate(-1); else navigate(item ? titlePath(item) : "/");
  }, [navigate, item, save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case " ": case "k": e.preventDefault(); toggle(); break;
        case "ArrowLeft": e.preventDefault(); skip(-10); break;
        case "ArrowRight": e.preventDefault(); skip(10); break;
        case "f": fullscreen(); break;
        case "m": if (video.current) video.current.muted = !video.current.muted; break;
        case "Escape": if (!document.fullscreenElement) close(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, skip, fullscreen, close]);

  const remaining = duration ? duration - time : 0;
  const showNext = next && duration > 0 && remaining < Math.min(60, Math.max(20, duration * 0.025)) + 10;

  return (
    <div className={chrome ? "player" : "player player-quiet"} ref={stage} onMouseMove={poke} onClick={(e) => { if (e.target === video.current) toggle(); }}>
      <video
        ref={video}
        className="player-video"
        playsInline
        onPlay={() => { setPlaying(true); poke(); }}
        onPause={() => { setPlaying(false); setChrome(true); save(true); }}
        onTimeUpdate={(e) => { setTime(e.currentTarget.currentTime); save(); }}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onProgress={(e) => { const b = e.currentTarget.buffered; if (b.length) setBuffered(b.end(b.length - 1)); }}
        onEnded={() => { save(true); if (next) navigate(playPath(next.id), { replace: true }); }}
      >
        {subtitleURL && <track kind="subtitles" src={subtitleURL} default label="Subtitles" />}
      </video>

      <div className="player-top">
        <div className="player-title">
          <button type="button" className="icon-button icon-button-large" aria-label="Close (Esc)" onClick={close}><CloseIcon /></button>
          <div>
            <div className="strong">{title}</div>
            {subtitle && <div className="muted small">{subtitle}</div>}
          </div>
        </div>
        <div className="player-tools">
          {item && <Link to={titlePath(item)} className="pill pill-small"><InfoIcon size={16} />{item.kind === "tv" ? "Show details" : "Movie details"}</Link>}
          <div className="menu-anchor">
            <button type="button" className="icon-button" aria-label="Subtitles" aria-expanded={subtitleMenu} onClick={() => setSubtitleMenu(!subtitleMenu)}><SubtitlesIcon /></button>
            {subtitleMenu && (
              <div className="menu menu-right" role="menu">
                <button type="button" role="menuitemradio" aria-checked={!subtitleKey} onClick={() => { setSubtitleKey(null); setSubtitleMenu(false); }}>Off</button>
                {(subtitles.data ?? []).map((s: PutioSubtitle) => (
                  <button key={s.key} type="button" role="menuitemradio" aria-checked={subtitleKey === s.key} onClick={() => { setSubtitleKey(s.key); setSubtitleMenu(false); }}>
                    {s.language ?? s.name ?? s.key}
                  </button>
                ))}
                {subtitles.isSuccess && !subtitles.data.length && <div className="menu-note">No subtitles from put.io</div>}
              </div>
            )}
          </div>
          {document.pictureInPictureEnabled && (
            <button type="button" className="icon-button" aria-label="Picture in picture" onClick={() => { void video.current?.requestPictureInPicture(); }}><PipIcon /></button>
          )}
          <button type="button" className="icon-button" aria-label="Full screen (F)" onClick={fullscreen}><FullscreenIcon /></button>
        </div>
      </div>

      {error ? (
        <div className="player-center player-error">
          <p>{error}</p>
          <button type="button" className="pill" onClick={close}>Close</button>
        </div>
      ) : (
        <div className="player-center">
          <button type="button" className="round-button round-large" aria-label="Back 10 seconds (Left arrow)" onClick={() => skip(-10)}><Back10 size={26} /></button>
          <button type="button" className="round-button round-huge" aria-label={playing ? "Pause (Space)" : "Play (Space)"} onClick={toggle}>
            {playing ? <PauseIcon size={34} /> : <PlayIcon size={34} />}
          </button>
          <button type="button" className="round-button round-large" aria-label="Forward 10 seconds (Right arrow)" onClick={() => skip(10)}><Forward10 size={26} /></button>
        </div>
      )}

      {resumedFrom > 0 && time < resumedFrom + 8 && (
        <button type="button" className="pill pill-small start-over" onClick={() => { if (video.current) video.current.currentTime = 0; setResumedFrom(0); }}>
          Resumed at {clock(resumedFrom)} · Start over
        </button>
      )}

      {showNext && next && (
        <div className="next-card">
          <div className="eyebrow">NEXT EPISODE</div>
          <div className="strong">{defaultCaption(next).replace(`${next.match?.title} · `, "")}</div>
          <div className="actions">
            <Link to={playPath(next.id)} replace className="pill pill-primary pill-small"><PlayIcon size={12} />Play now</Link>
          </div>
        </div>
      )}

      <div className="player-bottom">
        <div className="scrubber">
          <div className="scrubber-track" />
          <div className="scrubber-buffered" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
          <div className="scrubber-played" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
          <input type="range" aria-label="Position" min={0} max={duration || 0} step={1} value={time}
            onChange={(e) => { if (video.current) video.current.currentTime = Number(e.target.value); setTime(Number(e.target.value)); poke(); }} />
        </div>
        <div className="player-times">
          <span className="tabular">{clock(time)}</span>
          <span className="shortcuts">Space play / pause · ← → 10 seconds · F full screen · Esc close</span>
          <span className="tabular">−{clock(remaining)}</span>
        </div>
      </div>
    </div>
  );
}
