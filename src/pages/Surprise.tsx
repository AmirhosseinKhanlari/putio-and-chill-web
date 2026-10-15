import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { discoverPage } from "../api/surprise";
import { image, tmdb, type CatalogItem, type MediaKind } from "../api/tmdb";
import { playPath, titlePath } from "../components/Cards";
import { CheckIcon, DiceIcon, InfoIcon, PlayIcon, PlusIcon } from "../components/Icons";
import { TopBar } from "../components/TopBar";
import { runtime } from "../lib/format";
import { choose, initialSurprise, itemKey, moodByID, moods, roll, type SurpriseState } from "../lib/surprise";
import { useLibrary, useMyList } from "../state/hooks";
import "../styles/surprise.css";

const day = 24 * 60 * 60_000;

/** "Can't decide?": a big random pick for a mood. Shuffle with the dice, the Space key or a swipe left;
 * "Not feeling it?" offers other matches for the same mood. Like the iPhone's SurprisePage. */
export function Surprise() {
  // Kind and mood live in the URL, so Back from a title returns to the same mood.
  const [params, setParams] = useSearchParams();
  const kind: MediaKind = params.get("kind") === "tv" ? "tv" : "movie";
  const mood = moodByID(params.get("mood"));
  const queryClient = useQueryClient();
  const [state, setState] = useState<SurpriseState>(initialSurprise);
  const [status, setStatus] = useState<"rolling" | "ready" | "error">("rolling");
  const [shuffles, setShuffles] = useState(0);
  const latest = useRef(state);
  latest.current = state;
  const ticket = useRef(0);

  const shuffle = useCallback(async () => {
    // The newest roll wins when moods change faster than TMDB answers.
    const mine = ++ticket.current;
    setStatus("rolling");
    setShuffles((n) => n + 1);
    try {
      const next = await roll(latest.current, (page) => queryClient.fetchQuery({
        queryKey: ["surprise", kind, mood.id, page], queryFn: () => discoverPage(kind, mood, page), staleTime: day,
      }));
      if (mine !== ticket.current) return;
      setState(next);
      setStatus("ready");
    } catch {
      if (mine === ticket.current) setStatus("error");
    }
  }, [kind, mood, queryClient]);

  // Rolls on arrival and whenever the kind or mood changes.
  useEffect(() => { void shuffle(); }, [shuffle]);

  // Space shuffles, unless it's typing or pressing a focused button or link.
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== " " || event.repeat || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, button, a, summary, [contenteditable], [role='button'], [role='textbox']")) return;
      event.preventDefault();
      void shuffleRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const set = (key: "kind" | "mood", value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };

  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => { swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: TouchEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x, dy = e.changedTouches[0].clientY - start.y;
    if (dx < -80 && Math.abs(dy) < 120) void shuffle();
  };

  const { pick } = state;
  const rolling = status === "rolling";

  return (
    <div className="page surprise-page">
      <section className={rolling ? "surprise-stage surprise-rolling" : "surprise-stage"} aria-label="Surprise me">
        {pick && <Backdrop key={itemKey(pick)} item={pick} />}
        <div className="surprise-scrim" />
        <TopBar back />

        <div className="surprise-controls">
          <div className="surprise-controls-row">
            <div className="eyebrow surprise-label">SURPRISE ME</div>
            <div className="segmented surprise-kind" role="group" aria-label="Movies or series">
              {(["movie", "tv"] as const).map((k) => (
                <button key={k} type="button" className={kind === k ? "segment segment-on" : "segment"} aria-pressed={kind === k} onClick={() => set("kind", k)}>
                  {k === "movie" ? "Movies" : "Series"}
                </button>
              ))}
            </div>
          </div>
          <div className="mood-chips" role="group" aria-label="Mood">
            {moods.map((m) => (
              <button key={m.id} type="button" className="mood-chip" aria-pressed={m.id === mood.id} onClick={() => set("mood", m.id)}>
                <span aria-hidden="true">{m.emoji}</span>{m.title}
              </button>
            ))}
          </div>
        </div>

        <div className="surprise-spacer" />

        <div className="surprise-pick" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {status === "error" ? (
            <div className="surprise-message">
              <h1 className="surprise-message-title">Couldn't get a pick</h1>
              <p className="muted">TMDB didn't answer. Check your connection and try again.</p>
              <div className="actions"><button type="button" className="pill pill-primary" onClick={() => void shuffle()}>Try Again</button></div>
            </div>
          ) : state.empty && !rolling ? (
            <div className="surprise-message">
              <h1 className="surprise-message-title">Nothing matched that mood</h1>
              <p className="muted">Try another mood or switch between movies and series.</p>
            </div>
          ) : pick ? (
            <Pick item={pick} moodLabel={`${mood.emoji} ${mood.title.toUpperCase()}`} shuffles={shuffles} rolling={rolling} onShuffle={() => void shuffle()} />
          ) : (
            <p className="muted surprise-loading">Picking something…</p>
          )}
        </div>

        {state.alternatives.length > 0 && status !== "error" && (
          <section className="surprise-alts" aria-labelledby="alts-heading">
            <h2 id="alts-heading" className="surprise-alts-title">Not feeling it?</h2>
            <div className="surprise-alts-row">
              {state.alternatives.map((alt) => (
                <button key={itemKey(alt)} type="button" className="alt-card" onClick={() => setState((s) => choose(s, alt))}>
                  <img src={image(alt.backdropPath, "w500")} alt="" loading="lazy" />
                  <span className="alt-title">{alt.title}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        <p className="visually-hidden" aria-live="polite">{pick && !rolling ? `Tonight's pick: ${pick.title}` : ""}</p>
      </section>
    </div>
  );
}

/** The wide still; upright phones get the poster, which fills the screen better. */
function Backdrop({ item }: { item: CatalogItem }) {
  const wide = image(item.backdropPath ?? item.posterPath, "w1280");
  const tall = item.posterPath ? image(item.posterPath, "w780") : undefined;
  if (!wide) return null;
  return (
    <picture className="surprise-backdrop">
      {tall && <source media="(max-width: 600px) and (orientation: portrait)" srcSet={tall} />}
      <img src={wide} alt="" />
    </picture>
  );
}

function Pick({ item, moodLabel, shuffles, rolling, onShuffle }: { item: CatalogItem; moodLabel: string; shuffles: number; rolling: boolean; onShuffle: () => void }) {
  const lib = useLibrary();
  const myList = useMyList();
  // Same cache as the title page, so opening it after is instant.
  const detail = useQuery({ queryKey: ["detail", item.kind, item.tmdbID], queryFn: () => tmdb.detail(item.kind, item.tmdbID), staleTime: 60 * 60_000 });
  // Watch This plays when it's in put.io (where it was left off, else the first file), as Home's hero does.
  const files = lib.matching(item.tmdbID).filter((e) => e.match?.kind === item.kind);
  const started = lib.continueWatching().find((e) => e.match?.tmdbID === item.tmdbID && e.match.kind === item.kind);
  const first = [...files].sort((a, b) => ((a.match?.season ?? 0) - (b.match?.season ?? 0)) || ((a.match?.episode ?? 0) - (b.match?.episode ?? 0)))[0];
  const playable = started ?? first;
  const saved = myList.has(item);
  const genres = detail.data?.genres.slice(0, 4) ?? [];
  const overview = detail.data?.item.overview || item.overview;
  const length = runtime(detail.data?.runtimeMinutes);
  const seasons = detail.data?.numberOfSeasons;

  return (
    <div className="surprise-pick-layout">
      <div key={itemKey(item)} className="surprise-content">
        <div className="eyebrow">TONIGHT'S PICK · {moodLabel}</div>
        <h1 className="surprise-title"><Link to={titlePath(item)} className="quiet-link">{item.title}</Link></h1>
        <div className="meta-row">
          {item.year && <span>{item.year}</span>}
          <span>{item.kind === "tv" ? "Series" : "Film"}</span>
          {length && <span>{length}</span>}
          {item.kind === "tv" && seasons ? <span>{seasons} season{seasons === 1 ? "" : "s"}</span> : null}
          {files.length > 0 && <span className="in-putio"><CheckIcon size={15} />In put.io</span>}
          {item.rating ? <><span className="badge-tmdb">TMDB</span><span className="strong">{Math.round(item.rating * 10)}%</span></> : null}
        </div>
        {genres.length > 0 && <div className="muted small">{genres.join(" · ")}</div>}
        {overview && <p className="surprise-overview">{overview}</p>}
        <div className="actions">
          <Link to={playable ? playPath(playable.id) : titlePath(item)} className="pill pill-primary"><PlayIcon size={16} />Watch This</Link>
          {playable && <Link to={titlePath(item)} className="pill"><InfoIcon />More Info</Link>}
          <button type="button" className="pill" aria-pressed={saved} onClick={() => myList.toggle(item)}>
            {saved ? <CheckIcon /> : <PlusIcon />}My List
          </button>
        </div>
      </div>
      {/* Outside the keyed block, so it stays put and spins once per shuffle. */}
      <button type="button" className="surprise-dice" aria-busy={rolling} aria-keyshortcuts="Space" onClick={onShuffle}>
        <span className="surprise-dice-face" style={{ transform: `rotate(${shuffles * 360}deg)` }}><DiceIcon size={26} /></span>
        <span className="surprise-dice-label">Shuffle</span>
      </button>
    </div>
  );
}
