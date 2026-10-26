import { useState } from "react";
import { Link } from "react-router-dom";
import { image, type CatalogItem } from "../api/tmdb";
import { left as leftLabel } from "../lib/format";
import type { LibraryEntry } from "../lib/library";
import { upNextLabel, type UpNext } from "../lib/upNext";
import { entryItem, useLibrary } from "../state/hooks";
import { CheckIcon, PlayIcon } from "./Icons";

export const titlePath = (item: Pick<CatalogItem, "kind" | "tmdbID">) => `/title/${item.kind}/${item.tmdbID}`;
export const playPath = (fileID: number) => `/play/${fileID}`;

/** How much of a video is watched, as a thin bar under its picture. */
export function WatchedBar({ fraction }: { fraction: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div className="watched" role="img" aria-label={`${pct}% watched`}>
      <div className="watched-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A poster, or the title on a quiet tile when TMDB has no artwork. */
export function Poster({ path, title, children }: { path?: string | null; title: string; children?: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  const src = image(path, "w342");
  return (
    <div className="poster">
      {src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : <div className="poster-fallback">{title}</div>}
      {children}
    </div>
  );
}

export function PosterCard({ item, inPutio = false }: { item: CatalogItem; inPutio?: boolean }) {
  return (
    <Link to={titlePath(item)} className="card" title={item.title}>
      <Poster path={item.posterPath} title={item.title}>
        {inPutio && <span className="badge-in-putio" role="img" aria-label="In put.io"><CheckIcon size={13} /></span>}
      </Poster>
      <span className="card-caption">{item.title}</span>
    </Link>
  );
}

/** A watched video's mark on its picture. */
export const WatchedChip = () => <span className="chip-left"><CheckIcon size={11} />Watched</span>;

/** A file in put.io (Continue Watching, Recently Added): opens the player; a show's title page from "Details". */
export function EntryCard({ entry, caption }: { entry: LibraryEntry; caption?: string }) {
  const lib = useLibrary();
  const resume = lib.resumeSeconds(entry);
  const watched = lib.watchedFraction(entry);
  const remaining = lib.remainingSeconds(entry);
  const item = entryItem(entry);
  const label = remaining !== undefined ? leftLabel(remaining) : resume >= 30 ? `Resume ${clockShort(resume)}` : undefined;
  const done = !label && lib.isWatched(entry.id);
  const sub = caption ?? defaultCaption(entry);
  return (
    <div className="card">
      <Link to={playPath(entry.id)} className="card-link" aria-label={`Play ${sub}`}>
        <Poster path={entry.match?.posterPath} title={entry.match?.title ?? entry.name}>
          {label && <span className="chip-left"><PlayIcon size={10} />{label}</span>}
          {done && <WatchedChip />}
        </Poster>
      </Link>
      {watched !== undefined && <WatchedBar fraction={watched} />}
      <span className="card-caption">
        {item ? <Link to={titlePath(item)} className="quiet-link">{sub}</Link> : sub}
      </span>
    </div>
  );
}

/** Continue Watching's card for a show whose latest episode was finished: the next one, from the start. One that
 * isn't in put.io yet opens the show's page on that episode instead. */
export function UpNextCard({ show, next }: { show: CatalogItem; next: UpNext }) {
  const label = upNextLabel(next);
  const to = next.entry ? `${playPath(next.entry.id)}?from=0` : `${titlePath(show)}?season=${next.season}&episode=${next.episode}`;
  return (
    <div className="card">
      <Link to={to} className="card-link" aria-label={next.entry ? `Play ${show.title}, ${label}` : `${show.title}, ${label}`}>
        <Poster path={show.posterPath} title={show.title} />
      </Link>
      <span className="card-caption"><Link to={titlePath(show)} className="quiet-link">{show.title}</Link></span>
      <span className="card-caption card-caption-sub" title={label}>{label}</span>
    </div>
  );
}

function clockShort(seconds: number) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function defaultCaption(entry: LibraryEntry) {
  const m = entry.match;
  if (!m) return entry.name;
  if (m.kind === "tv" && m.season !== undefined) return `${m.title} · S${m.season}${m.episode !== undefined ? ` E${m.episode}` : ""}`;
  return m.title;
}
