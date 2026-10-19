import { useQuery } from "@tanstack/react-query";
import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { defaultCaption, playPath, titlePath } from "../components/Cards";
import { Back10, CloseIcon, Forward10, FullscreenIcon, InfoIcon, PauseIcon, PipIcon, PlayIcon, SubtitlesIcon } from "../components/Icons";
import { AudioIcon, ChoiceMenu, SPEEDS, speedText } from "../components/player/ChoiceMenu";
import { creditsLength, nextUpCardState } from "../components/player/nextUp";
import { NextUpCard } from "../components/player/NextUpCard";
import { SubtitleMenu } from "../components/player/SubtitleMenu";
import { SubtitleOverlay, useVideoFrame } from "../components/player/SubtitleOverlay";
import { audioLabels, bestAudioIndex } from "../components/player/subtitles";
import { useSubtitles } from "../components/player/useSubtitles";
import { clock } from "../lib/format";
import type { LibraryEntry } from "../lib/library";
import { PLAYER_TIMEOUT_MS, positionSync } from "../lib/positionSync";
import { useSettings } from "../lib/settings";
import { entryItem, useLibrary } from "../state/hooks";
import { usePutio } from "../state/session";

const SAVE_EVERY = 10;
/** How long "Resumed at … · Start over" stays once playback starts. */
const RESUME_NOTICE_MS = 8000;

type Menu = "subtitles" | "audio" | "speed";

/** Safari's own audio track list (not in TypeScript's DOM types). */
interface NativeAudioTrack { label: string; language: string; enabled: boolean }
interface NativeAudioTracks extends EventTarget { length: number; [index: number]: NativeAudioTrack }
const nativeAudio = (el: HTMLVideoElement) => (el as HTMLVideoElement & { audioTracks?: NativeAudioTracks }).audioTracks;

/** The next episode in put.io: the same season's next one, else the next season's first. */
function nextEpisode(entries: LibraryEntry[], current?: LibraryEntry): LibraryEntry | undefined {
  const m = current?.match;
  if (!m || m.kind !== "tv" || m.season === undefined || m.episode === undefined) return undefined;
  const show = entries.filter((e) => e.match?.tmdbID === m.tmdbID && e.match.season !== undefined && e.match.episode !== undefined);
  return show.find((e) => e.match!.season === m.season && e.match!.episode === m.episode! + 1)
    ?? show.filter((e) => e.match!.season === m.season! + 1).sort((a, b) => a.match!.episode! - b.match!.episode!)[0];
}

/** One screen per file: playing the next episode starts fresh (subtitles, audio, resume notice). */
export function Player() {
  const { fileID } = useParams();
  return <PlayerScreen key={fileID} id={Number(fileID)} />;
}

function PlayerScreen({ id }: { id: number }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const putio = usePutio();
  const settings = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const lib = useLibrary();
  const entry = lib.entries.find((e) => e.id === id);
  const file = useQuery({ queryKey: ["file", id], queryFn: () => putio.file(id), staleTime: 0 });

  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const bottomBar = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls>();
  const lastSaved = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef<Menu | null>(null);
  menuRef.current = menu;
  const [resumedFrom, setResumedFrom] = useState(0);
  const [resumeNotice, setResumeNotice] = useState(false);
  const [audio, setAudio] = useState<{ labels: string[]; index: number }>({ labels: [], index: -1 });
  const [rate, setRate] = useState(1);
  const [ended, setEnded] = useState(false);
  const [creditsDismissed, setCreditsDismissed] = useState(false);
  const [pip, setPip] = useState(false);
  const pipRef = useRef(false);
  pipRef.current = pip;

  const next = nextEpisode(lib.entries, entry);
  const item = entry ? entryItem(entry) : undefined;
  const title = entry ? (entry.match?.title ?? entry.name) : file.data?.name ?? "";
  const subtitle = entry?.match?.kind === "tv" ? defaultCaption(entry).replace(`${entry.match.title} · `, "") : entry?.match?.year ? String(entry.match.year) : "";
  const subs = useSubtitles({ fileID: id, fileName: entry?.name ?? file.data?.name, entry, putio, settings, searching: menu === "subtitles" });

  // Start: put.io's stream from where you left off (or ?from=0 to start over). Where you left off is asked of put.io
  // first (briefly), in case another device moved on; the newest position wins, else the one known here.
  const from = params.get("from");
  const [positionChecked, setPositionChecked] = useState(from !== null);
  useEffect(() => {
    if (from !== null) return;
    let live = true;
    void positionSync.fetch(putio, id, PLAYER_TIMEOUT_MS).catch(() => {}).finally(() => { if (live) setPositionChecked(true); });
    return () => { live = false; };
    // Once per file, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const startAt = from !== null ? Number(from)
    : entry ? lib.resumeSeconds(entry) : lib.position(id)?.seconds ?? file.data?.start_from ?? 0;
  const ready = positionChecked && Boolean(entry || file.data);
  useEffect(() => {
    const el = video.current;
    if (!el || !ready) return;
    const src = putio.hlsURL(id);
    const resumeAt = startAt >= 30 ? startAt : 0;
    setResumedFrom(resumeAt);
    setResumeNotice(resumeAt > 0);
    lastSaved.current = resumeAt;
    let hls: Hls | undefined;
    let cleanupNative = () => {};
    const seekAndPlay = () => {
      if (resumeAt) el.currentTime = resumeAt;
      el.play().catch(() => setChrome(true));
    };
    if (Hls.isSupported()) {
      const player = new Hls({ startPosition: resumeAt || -1 });
      hls = player;
      hlsRef.current = player;
      player.subtitleDisplay = false; // Subtitles are drawn by the app.
      player.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError(data.type === Hls.ErrorTypes.NETWORK_ERROR ? "put.io couldn't stream this video right now." : "This video can't play in the browser.");
      });
      // Audio: the preferred language from Settings the first time the tracks are known.
      let pickedAudio = false;
      player.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        const tracks = data.audioTracks;
        if (!pickedAudio) {
          pickedAudio = true;
          const preferred = bestAudioIndex(tracks.map((t) => t.lang), settingsRef.current.audioLanguage);
          if (preferred !== undefined && preferred !== player.audioTrack) player.audioTrack = preferred;
        }
        setAudio({ labels: audioLabels(tracks.map((t) => ({ name: t.name, lang: t.lang, channels: t.channels }))), index: player.audioTrack });
      });
      player.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => setAudio((a) => ({ ...a, index: player.audioTrack })));
      player.loadSource(src);
      player.attachMedia(el);
      player.on(Hls.Events.MANIFEST_PARSED, () => el.play().catch(() => setChrome(true)));
    } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = src; // Safari plays HLS itself.
      el.addEventListener("loadedmetadata", seekAndPlay, { once: true });
      const tracks = nativeAudio(el);
      if (tracks) {
        let pickedAudio = false;
        const update = () => {
          const list = Array.from({ length: tracks.length }, (_, i) => tracks[i]);
          if (!pickedAudio && list.length) {
            pickedAudio = true;
            const preferred = bestAudioIndex(list.map((t) => t.language), settingsRef.current.audioLanguage);
            if (preferred !== undefined) list.forEach((t, i) => { t.enabled = i === preferred; });
          }
          setAudio({ labels: audioLabels(list.map((t) => ({ name: t.label, lang: t.language }))), index: list.findIndex((t) => t.enabled) });
        };
        tracks.addEventListener("addtrack", update);
        tracks.addEventListener("change", update);
        cleanupNative = () => { tracks.removeEventListener("addtrack", update); tracks.removeEventListener("change", update); };
      }
    } else {
      setError("This browser can't play put.io streams.");
    }
    return () => { hls?.destroy(); hlsRef.current = undefined; cleanupNative(); };
    // Restart only for another file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ready]);

  // Saving the position to put.io (and how long the video is, for the watched bars).
  const save = useCallback((force = false, el: HTMLVideoElement | null = video.current) => {
    if (!el || !el.duration || !Number.isFinite(el.duration)) return;
    const position = Math.floor(el.currentTime);
    if (!force && Math.abs(position - lastSaved.current) < SAVE_EVERY) return;
    lastSaved.current = position;
    void positionSync.save(putio, id, position, el.duration);
  }, [id, putio]);

  useEffect(() => {
    // Held here: React has let go of the ref by the time this cleanup runs.
    const el = video.current;
    const onHide = () => save(true, el);
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("pagehide", onHide); save(true, el); };
  }, [save]);

  // "Resumed at … · Start over" goes a few seconds after playback starts (or on a seek, or when pressed).
  useEffect(() => {
    if (!resumeNotice || !playing) return;
    const timer = window.setTimeout(() => setResumeNotice(false), RESUME_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [resumeNotice, playing]);

  // Subtitles: our <track> stays "hidden" (the overlay draws it), except in Picture in Picture where only the
  // browser can draw. Tracks from the stream itself stay off.
  const ownTrack = useRef<TextTrack | null>(null);
  const [textTrack, setTextTrack] = useState<TextTrack | null>(null);
  const trackRef = useCallback((el: HTMLTrackElement | null) => {
    ownTrack.current = el?.track ?? null;
    if (el) el.track.mode = pipRef.current ? "showing" : "hidden";
    setTextTrack(el?.track ?? null);
  }, []);
  useEffect(() => {
    if (textTrack) textTrack.mode = pip ? "showing" : "hidden";
  }, [textTrack, pip]);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const quiet = () => {
      for (const t of Array.from(el.textTracks)) if (t !== ownTrack.current && t.mode !== "disabled") t.mode = "disabled";
    };
    const enter = () => setPip(true);
    const leave = () => setPip(false);
    el.textTracks.addEventListener("addtrack", quiet);
    el.textTracks.addEventListener("change", quiet);
    el.addEventListener("enterpictureinpicture", enter);
    el.addEventListener("leavepictureinpicture", leave);
    return () => {
      el.textTracks.removeEventListener("addtrack", quiet);
      el.textTracks.removeEventListener("change", quiet);
      el.removeEventListener("enterpictureinpicture", enter);
      el.removeEventListener("leavepictureinpicture", leave);
    };
  }, []);

  // Where the subtitles, the resume notice and the Next Episode card sit: clear of the bottom controls while shown.
  const frame = useVideoFrame(stage, video);
  const [controlsHeight, setControlsHeight] = useState(96);
  useEffect(() => {
    const bar = bottomBar.current, box = stage.current;
    if (!bar || !box) return;
    const measure = () => setControlsHeight(Math.round(box.getBoundingClientRect().bottom - bar.getBoundingClientRect().top));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const lift = chrome ? controlsHeight + 12 : 0;

  // Controls hide while playing and the mouse is still (not while a menu is open).
  const hideTimer = useRef<number>();
  const poke = useCallback(() => {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => { if (!video.current?.paused && !menuRef.current) setChrome(false); }, 3000);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const toggleMenu = useCallback((which: Menu) => {
    setMenu((open) => (open === which ? null : which));
    poke();
  }, [poke]);
  const closeMenu = useCallback(() => { setMenu(null); poke(); }, [poke]);

  // A click outside a menu closes it (and only that: the click doesn't also pause).
  const swallowClick = useRef(false);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest(".menu-anchor")) return;
      swallowClick.current = e.target === video.current;
      setMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  const toggle = useCallback(() => {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play(); else el.pause();
    poke();
  }, [poke]);
  const seekTo = useCallback((seconds: number) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min((el.duration || 0) - 1, seconds));
    setResumeNotice(false);
    poke();
  }, [poke]);
  const skip = useCallback((seconds: number) => {
    if (video.current) seekTo(video.current.currentTime + seconds);
  }, [seekTo]);
  const chooseSpeed = useCallback((value: number) => {
    const el = video.current;
    if (!el) return;
    el.defaultPlaybackRate = value;
    el.playbackRate = value;
    setRate(value);
  }, []);
  const chooseAudio = useCallback((index: number) => {
    const el = video.current;
    if (hlsRef.current) {
      hlsRef.current.audioTrack = index;
    } else if (el) {
      const tracks = nativeAudio(el);
      if (tracks) for (let i = 0; i < tracks.length; i++) tracks[i].enabled = i === index;
    }
    setAudio((a) => ({ ...a, index }));
  }, []);
  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen();
  }, []);
  const close = useCallback(() => {
    save(true);
    if (window.history.length > 1) navigate(-1); else navigate(item ? titlePath(item) : "/");
  }, [navigate, item, save]);
  const playNext = useCallback(() => {
    if (!next) return;
    save(true);
    navigate(playPath(next.id), { replace: true });
  }, [next, save, navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (menuRef.current) {
        if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
        // Inside a menu, keys work its buttons and pickers.
        if (e.target instanceof Element && e.target.closest(".menu")) return;
      }
      switch (e.key) {
        case " ": case "k": e.preventDefault(); toggle(); break;
        case "ArrowLeft": e.preventDefault(); skip(-10); break;
        case "ArrowRight": e.preventDefault(); skip(10); break;
        case "f": fullscreen(); break;
        case "m": if (video.current) video.current.muted = !video.current.muted; break;
        case "<": chooseSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(rate) - 1)] ?? 1); break;
        case ">": chooseSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(rate) + 1)] ?? 1); break;
        case "Escape": if (!document.fullscreenElement && !menuRef.current) close(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, skip, fullscreen, close, closeMenu, chooseSpeed, rate]);

  // Next Episode: shows when the credits start, counts down and plays (Settings → auto-play), hides on a seek back.
  const remaining = duration ? duration - time : 0;
  const cardState = next ? nextUpCardState(time, duration, ended, creditsDismissed) : "hidden";
  useEffect(() => {
    if (creditsDismissed && duration && remaining > creditsLength(duration)) setCreditsDismissed(false);
  }, [creditsDismissed, duration, remaining]);

  return (
    <div className={chrome ? "player" : "player player-quiet"} ref={stage} onMouseMove={poke}
      onClick={(e) => {
        const swallow = swallowClick.current;
        swallowClick.current = false;
        if (!swallow && e.target === video.current) toggle();
      }}>
      <video
        ref={video}
        className="player-video"
        playsInline
        onPlay={() => { setPlaying(true); setEnded(false); poke(); }}
        onPause={() => { setPlaying(false); setChrome(true); save(true); }}
        onTimeUpdate={(e) => { setTime(e.currentTarget.currentTime); save(); }}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onProgress={(e) => { const b = e.currentTarget.buffered; if (b.length) setBuffered(b.end(b.length - 1)); }}
        onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
        onSeeking={(e) => { if (e.currentTarget.duration - e.currentTarget.currentTime > 1.5) setEnded(false); }}
        onEnded={() => { setEnded(true); setChrome(true); save(true); }}
      >
        {subs.trackURL && <track key={subs.trackURL} ref={trackRef} kind="subtitles" src={subs.trackURL} label="Subtitles" />}
      </video>

      {!error && <SubtitleOverlay track={textTrack} style={settings.subtitleStyle} frame={frame} lift={lift} />}

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
          {audio.labels.length > 1 && (
            <div className="menu-anchor">
              <button type="button" className="icon-button" aria-label="Audio" aria-haspopup="menu" aria-expanded={menu === "audio"} onClick={() => toggleMenu("audio")}><AudioIcon /></button>
              {menu === "audio" && (
                <ChoiceMenu label="Audio" value={audio.index} options={audio.labels.map((label, i) => ({ value: i, label }))}
                  onChoose={(i) => { chooseAudio(i); closeMenu(); }} />
              )}
            </div>
          )}
          <div className="menu-anchor">
            <button type="button" className="icon-button speed-button tabular" aria-label={`Playback speed, ${speedText(rate)}`} aria-haspopup="menu" aria-expanded={menu === "speed"}
              onClick={() => toggleMenu("speed")}>{speedText(rate)}</button>
            {menu === "speed" && (
              <ChoiceMenu label="Speed" value={rate} options={SPEEDS.map((value) => ({ value, label: value === 1 ? "1× (normal)" : speedText(value) }))}
                onChoose={(value) => { chooseSpeed(value); closeMenu(); }} />
            )}
          </div>
          <div className="menu-anchor">
            <button type="button" className="icon-button" data-on={subs.showing} aria-label={subs.showing ? "Subtitles (on)" : "Subtitles"} aria-haspopup="dialog" aria-expanded={menu === "subtitles"}
              onClick={() => toggleMenu("subtitles")}><SubtitlesIcon /></button>
            {menu === "subtitles" && <SubtitleMenu subtitles={subs} style={settings.subtitleStyle} onPicked={closeMenu} />}
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

      {resumeNotice && resumedFrom > 0 && (
        <button type="button" className="pill pill-small resume-notice" style={{ bottom: chrome ? lift : 24 }}
          onClick={() => { seekTo(0); setResumeNotice(false); }}>
          Resumed at {clock(resumedFrom)} · Start over
        </button>
      )}

      {next && cardState !== "hidden" && (
        <NextUpCard next={next} state={cardState} autoplay={settings.autoPlayNextEpisode} playing={playing} lift={lift}
          onPlay={playNext} onWatchCredits={() => setCreditsDismissed(true)} />
      )}

      <div className="player-bottom" ref={bottomBar}>
        <div className="scrubber">
          <div className="scrubber-track" />
          <div className="scrubber-buffered" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
          <div className="scrubber-played" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
          <input type="range" aria-label="Position" min={0} max={duration || 0} step={1} value={time}
            onChange={(e) => { seekTo(Number(e.target.value)); setTime(Number(e.target.value)); }} />
        </div>
        <div className="player-times">
          <span className="tabular">{clock(time)}</span>
          <span className="shortcuts">Space play / pause · ← → 10 seconds · &lt; &gt; speed · F full screen · Esc close</span>
          <span className="tabular">−{clock(remaining)}</span>
        </div>
      </div>
    </div>
  );
}
