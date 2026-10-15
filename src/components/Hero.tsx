import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { image, type CatalogItem } from "../api/tmdb";
import { left as leftLabel } from "../lib/format";
import { useLibrary, useMyList } from "../state/hooks";
import { playPath, titlePath } from "./Cards";
import { useGetAndWatch } from "./GetAndWatch";
import { CheckIcon, InfoIcon, PlayIcon, PlusIcon } from "./Icons";
import { TopBar } from "./TopBar";

/** The featured titles at the top of Home, Movies and TV: changes every 9 seconds, Play when it's in put.io. */
export function Hero({ items, label }: { items: CatalogItem[]; label: string }) {
  const featured = items.filter((i) => i.backdropPath).slice(0, 6);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (featured.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % featured.length), 9000);
    return () => clearInterval(timer);
  }, [featured.length]);
  const item = featured[index % Math.max(1, featured.length)];

  return (
    <section className="hero" aria-label="Featured">
      {item && <img key={item.tmdbID} className="hero-image" src={image(item.backdropPath, "w1280")} alt="" />}
      <div className="hero-scrim" />
      <TopBar overlay />
      {item && (
        <div className="hero-content">
          <div className="eyebrow">#{index + 1} {label} · {item.kind === "tv" ? "SERIES" : "FILM"}</div>
          <h1 className="display">{item.title}</h1>
          <HeroMeta item={item} />
          {item.overview && <p className="hero-overview">{item.overview}</p>}
          <HeroActions item={item} />
        </div>
      )}
      {featured.length > 1 && (
        <div className="hero-dots">
          {featured.map((f, i) => (
            <button key={f.tmdbID} type="button" aria-label={`Show ${f.title}`} aria-current={i === index} className={i === index ? "dot dot-on" : "dot"} onClick={() => setIndex(i)} />
          ))}
        </div>
      )}
    </section>
  );
}

function HeroMeta({ item }: { item: CatalogItem }) {
  const lib = useLibrary();
  const inPutio = lib.matching(item.tmdbID).some((e) => e.match?.kind === item.kind);
  return (
    <div className="meta-row">
      {item.year && <span>{item.year}</span>}
      {inPutio && <span className="in-putio"><CheckIcon size={15} />In put.io</span>}
      {item.rating ? <><span className="badge-tmdb">TMDB</span><span className="strong">{Math.round(item.rating * 10)}%</span></> : null}
    </div>
  );
}

function HeroActions({ item }: { item: CatalogItem }) {
  const lib = useLibrary();
  const myList = useMyList();
  const get = useGetAndWatch();
  const files = lib.matching(item.tmdbID).filter((e) => e.match?.kind === item.kind);
  const started = lib.continueWatching().find((e) => e.match?.tmdbID === item.tmdbID && e.match.kind === item.kind);
  const first = [...files].sort((a, b) => ((a.match?.season ?? 0) - (b.match?.season ?? 0)) || ((a.match?.episode ?? 0) - (b.match?.episode ?? 0)))[0];
  const playable = started ?? first;
  const saved = myList.has(item);
  const remaining = playable ? lib.remainingSeconds(playable) : undefined;
  const code = playable?.match?.season !== undefined ? `S${playable.match.season} E${playable.match.episode ?? ""} · ` : "";
  return (
    <div className="actions">
      {playable ? (
        <Link to={playPath(playable.id)} className="pill pill-primary">
          <PlayIcon size={16} />{started ? `Resume ${code}${remaining !== undefined ? leftLabel(remaining) : ""}`.replace(/ · $/, "") : "Play"}
        </Link>
      ) : item.kind === "movie" ? (
        <button type="button" className="pill pill-primary" disabled={get.busy} onClick={() => get.getBest({ item })}>
          <PlayIcon size={16} />{get.busy ? "Getting…" : "Get & Watch"}
        </button>
      ) : null}
      <Link to={titlePath(item)} className="pill"><InfoIcon />More Info</Link>
      <button type="button" className="pill" aria-pressed={saved} onClick={() => myList.toggle(item)}>
        {saved ? <CheckIcon /> : <PlusIcon />}My List
      </button>
    </div>
  );
}
