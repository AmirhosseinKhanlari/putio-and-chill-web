import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { image, tmdb } from "../api/tmdb";
import { titlePath } from "../components/Cards";
import { TopBar } from "../components/TopBar";
import { useLibrary, useMyList } from "../state/hooks";

/** The next episode of every show in put.io or on My List, soonest first. */
export function ComingUp() {
  const lib = useLibrary();
  const myList = useMyList();
  const ids = new Set<number>();
  for (const e of lib.entries) if (e.match?.kind === "tv") ids.add(e.match.tmdbID);
  for (const i of myList.items) if (i.kind === "tv") ids.add(i.tmdbID);
  const shows = [...ids].slice(0, 60);
  const details = useQueries({
    queries: shows.map((id) => ({ queryKey: ["detail", "tv", id], queryFn: () => tmdb.detail("tv", id), staleTime: 6 * 60 * 60_000 })),
  });
  const loading = details.some((d) => d.isLoading);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = details
    .flatMap((d) => (d.data?.nextEpisode?.airDate && d.data.nextEpisode.airDate >= today ? [{ detail: d.data, next: d.data.nextEpisode }] : []))
    .sort((a, b) => (a.next.airDate ?? "").localeCompare(b.next.airDate ?? ""));

  return (
    <div className="page">
      <TopBar />
      <div className="page-body narrow">
        <div className="page-title">
          <div className="eyebrow">YOUR SHOWS</div>
          <h1 className="display-small">Coming Up</h1>
        </div>
        {loading && <p className="muted">Checking your shows…</p>}
        {!loading && !upcoming.length && <p className="muted">No new episodes announced for your shows yet.</p>}
        <ul className="upcoming">
          {upcoming.map(({ detail, next }) => (
            <li key={detail.item.tmdbID}>
              <Link to={titlePath(detail.item)} className="upcoming-row">
                {detail.item.backdropPath ? <img src={image(detail.item.backdropPath, "w500")} alt="" /> : <div className="upcoming-fallback" />}
                <div>
                  <div className="strong">{detail.item.title}</div>
                  <div className="muted small">S{next.season} E{next.episode} · {next.name}</div>
                </div>
                <time className="upcoming-date" dateTime={next.airDate}>{formatDate(next.airDate)}</time>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function formatDate(date?: string) {
  if (!date) return "";
  const d = new Date(`${date}T12:00:00`);
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: days < 7 ? "long" : undefined, month: "short", day: "numeric" });
}
