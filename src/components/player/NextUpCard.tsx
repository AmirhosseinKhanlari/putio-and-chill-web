/** Netflix-style Next Episode card (the iPhone app's NextUpCard): what's next, Watch Credits, and a Next Episode
 * button that fills as it counts down, then plays by itself when auto-play is on. */
import { useEffect, useRef, useState } from "react";
import { image } from "../../api/tmdb";
import type { LibraryEntry } from "../../lib/library";
import { PlayIcon } from "../Icons";
import { COUNTDOWN_SECONDS, type NextUpCardState } from "./nextUp";
import "../../styles/player.css";

interface Props {
  next: LibraryEntry;
  state: Exclude<NextUpCardState, "hidden">;
  /** Settings → auto-play next episode. */
  autoplay: boolean;
  /** The countdown waits while the video is paused before its end. */
  playing: boolean;
  lift: number;
  onPlay: () => void;
  onWatchCredits: () => void;
}

export function NextUpCard({ next, state, autoplay, playing, lift, onPlay, onWatchCredits }: Props) {
  const counting = autoplay && (state === "end" || playing);
  const play = useRef(onPlay);
  play.current = onPlay;
  const [left, setLeft] = useState(COUNTDOWN_SECONDS);
  useEffect(() => {
    setLeft(COUNTDOWN_SECONDS);
    if (!counting) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const seconds = COUNTDOWN_SECONDS - Math.floor((Date.now() - started) / 1000);
      setLeft(Math.max(0, seconds));
      if (seconds <= 0) {
        window.clearInterval(timer);
        play.current();
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [counting, state]);

  const m = next.match;
  const label = m?.season !== undefined ? `S${m.season} E${m.episode ?? "?"}` : next.name;
  const still = image(m?.backdropPath, "w342");
  return (
    <section className="next-up" style={{ bottom: lift + 16 }} aria-label="Next episode">
      <div className="next-up-head">
        {still ? <img className="next-up-still" src={still} alt="" /> : <div className="next-up-still" />}
        <div className="next-up-text">
          <div className="eyebrow">NEXT EPISODE</div>
          <div className="strong">{m?.title ? `${m.title} · ${label}` : label}</div>
          {counting && <div className="muted small tabular">Plays in {left} s</div>}
        </div>
      </div>
      <div className="next-up-actions">
        {state === "credits" && <button type="button" className="pill pill-small" onClick={onWatchCredits}>Watch credits</button>}
        <button type="button" className="next-up-play" onClick={onPlay} aria-label={`Play next episode, ${label}`}>
          {/* Fills left to right as it counts down. */}
          <span key={`${state}-${counting}`} className={counting ? "next-up-fill next-up-fill-counting" : "next-up-fill"}
            style={{ animationDuration: `${COUNTDOWN_SECONDS}s` }} />
          <span className="next-up-label"><PlayIcon size={14} />Next episode</span>
        </button>
      </div>
    </section>
  );
}
