import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { image } from "../api/tmdb";
import type { PutioTransfer } from "../api/putio";
import { EntryCard, playPath, Poster, titlePath } from "../components/Cards";
import { CloseIcon, FolderIcon, PlayIcon, RefreshIcon } from "../components/Icons";
import { TopBar } from "../components/TopBar";
import { bytes, speed } from "../lib/format";
import type { LibraryEntry } from "../lib/library";
import { pendingTransfers, savePendingTransfers } from "../lib/smartGet";
import { refreshLibrary, useAccount, useLibrary, useMyList, useToast } from "../state/hooks";
import { usePutio } from "../state/session";

type Filter = "all" | "movie" | "tv" | "other";

export function Library() {
  const lib = useLibrary();
  const putio = usePutio();
  const account = useAccount();
  const myList = useMyList();
  const [filter, setFilter] = useState<Filter>("all");
  const disk = account.data?.disk;

  // One card per movie or show (a show's card opens it); unmatched videos play.
  const groups = new Map<string, LibraryEntry[]>();
  for (const e of [...lib.entries].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))) {
    const key = e.match ? `${e.match.kind}-${e.match.tmdbID}` : `f-${e.id}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const cards = [...groups.values()].filter((g) => {
    const kind = g[0].match?.kind ?? "other";
    return filter === "all" || kind === filter;
  });

  return (
    <div className="page">
      <TopBar />
      <div className="page-body narrow">
        <div className="library-head">
          <div className="stack-small">
            <h1 className="display-small">Library</h1>
            <div className="muted small">{lib.isRefreshing ? lib.progressText : lib.updatedAt ? `Updated ${ago(lib.updatedAt)}` : "Not read yet"}</div>
            {disk && (
              <>
                <div className="meter" role="img" aria-label={`${Math.round((disk.used / disk.size) * 100)}% of put.io storage used`}>
                  <div className="meter-fill" style={{ width: `${(disk.used / disk.size) * 100}%` }} />
                </div>
                <div className="small muted">put.io: {bytes(disk.used)} of {bytes(disk.size)} used · {bytes(disk.avail)} free{account.data?.trash_size ? ` · ${bytes(account.data.trash_size)} in Trash` : ""}</div>
              </>
            )}
          </div>
          <div className="actions">
            <Link to="/files" className="pill"><FolderIcon />Files</Link>
            <button type="button" className="pill" disabled={lib.isRefreshing} onClick={() => { void refreshLibrary(putio).then(() => account.refetch()); }}>
              <RefreshIcon />{lib.isRefreshing ? "Updating…" : "Update"}
            </button>
          </div>
        </div>

        <Transfers />

        <section className="stack">
          <div className="section-head">
            <h2>In your put.io</h2>
            <div className="segmented" role="tablist" aria-label="Show">
              {(["all", "movie", "tv", "other"] as Filter[]).map((f) => (
                <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "segment segment-on" : "segment"} onClick={() => setFilter(f)}>
                  {{ all: "All", movie: "Movies", tv: "TV", other: "Other" }[f]}
                </button>
              ))}
            </div>
          </div>
          {!cards.length && !lib.isRefreshing && <p className="muted">Nothing here yet. Get something from Home or Search and it shows up here.</p>}
          <div className="grid">
            {cards.map((g) => {
              const first = g[0];
              if (first.match?.kind === "tv") {
                const item = { tmdbID: first.match.tmdbID, kind: "tv" as const, title: first.match.title };
                return (
                  <Link key={`tv-${first.match.tmdbID}`} to={titlePath(item)} className="card">
                    <Poster path={first.match.posterPath} title={first.match.title}><span className="count-badge">{g.length}</span></Poster>
                    <span className="card-caption">{first.match.title} · {g.length} episode{g.length === 1 ? "" : "s"}</span>
                  </Link>
                );
              }
              return <EntryCard key={first.id} entry={first} />;
            })}
          </div>
        </section>

        {myList.items.length > 0 && (
          <section className="stack">
            <h2>My List</h2>
            <div className="grid">
              {myList.items.map((i) => (
                <Link key={`${i.kind}-${i.tmdbID}`} to={titlePath(i)} className="card"><Poster path={i.posterPath} title={i.title} /><span className="card-caption">{i.title}</span></Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ago(time: number) {
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(time).toLocaleDateString();
}

const isDone = (t: PutioTransfer) => t.status === "COMPLETED" || t.status === "SEEDING";
const isFailed = (t: PutioTransfer) => t.status === "ERROR";

/** Everything on its way to put.io (what Get & Watch sent first), live; finished ones play. */
function Transfers() {
  const putio = usePutio();
  const toast = useToast();
  const client = useQueryClient();
  const transfers = useQuery({ queryKey: ["transfers"], queryFn: () => putio.transfers(), refetchInterval: 5000 });
  const pending = pendingTransfers();
  const finished = useRef(new Set<number>());

  // A transfer that finishes adds files: read the library again (once per transfer).
  useEffect(() => {
    const done = (transfers.data ?? []).filter(isDone).map((t) => t.id).filter((id) => !finished.current.has(id));
    if (!done.length) return;
    const first = finished.current.size === 0;
    done.forEach((id) => finished.current.add(id));
    if (!first) void refreshLibrary(putio);
  }, [transfers.data, putio]);

  const shown = (transfers.data ?? []).filter((t) => !isDone(t) || pending.some((p) => p.transferID === t.id)).slice(0, 12);
  if (!shown.length) return null;

  async function cancel(t: PutioTransfer) {
    try {
      await (isDone(t) || isFailed(t) ? putio.cleanTransfers([t.id]) : putio.cancelTransfers([t.id]));
      savePendingTransfers(pendingTransfers().filter((p) => p.transferID !== t.id));
      await client.invalidateQueries({ queryKey: ["transfers"] });
    } catch {
      toast("Couldn't change that transfer right now.");
    }
  }

  return (
    <section className="stack">
      <h2>Downloading to put.io</h2>
      <div className="transfers">
        {shown.map((t) => {
          const p = pending.find((x) => x.transferID === t.id);
          const done = isDone(t);
          const label = p ? `${p.title}${p.episode !== undefined ? ` · S${p.season} E${p.episode}` : p.season !== undefined ? ` · Season ${p.season}` : ""}` : t.name ?? "Transfer";
          const status = done ? "Ready to watch" : isFailed(t) ? t.error_message || "Didn't download" : [`${t.percent_done ?? 0}%`, speed(t.down_speed)].filter(Boolean).join(" · ");
          return (
            <div key={t.id} className="transfer">
              {p?.posterPath ? <img src={image(p.posterPath, "w185")} alt="" /> : <div className="transfer-fallback" />}
              <div className="transfer-text">
                <div className="strong clamp-1">{label}</div>
                <div className={done ? "small good" : isFailed(t) ? "small error-text" : "small muted"}>{status}</div>
                {!done && !isFailed(t) && <div className="meter meter-thin"><div className="meter-fill" style={{ width: `${t.percent_done ?? 0}%` }} /></div>}
              </div>
              {done && t.file_id ? (
                // A whole season arrives as a folder: open it in Files.
                p?.season !== undefined && p.episode === undefined
                  ? <Link to={`/files/${t.file_id}`} className="round-button round-primary" aria-label={`Open ${label}`}><FolderIcon /></Link>
                  : <Link to={playPath(t.file_id)} className="round-button round-primary" aria-label={`Play ${label}`}><PlayIcon /></Link>
              ) : null}
              <button type="button" className="round-button round-quiet" aria-label={done ? `Remove ${label} from this list` : `Cancel ${label}`} onClick={() => void cancel(t)}><CloseIcon /></button>
            </div>
          );
        })}
      </div>
      {transfers.isError && <p className="error-text small">Couldn't read transfers from put.io.</p>}
    </section>
  );
}
