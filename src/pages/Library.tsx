import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { image } from "../api/tmdb";
import type { PutioTransfer } from "../api/putio";
import { EntryCard, playPath, Poster, titlePath, WatchedChip } from "../components/Cards";
import { Menu, placeUnder, type MenuPlace } from "../components/files/Menu";
import { FixMatchDialog } from "../components/FixMatch";
import { CloseIcon, FolderIcon, MoreIcon, PlayIcon, RefreshIcon } from "../components/Icons";
import { TopBar } from "../components/TopBar";
import { bytes, speed } from "../lib/format";
import type { LibraryEntry } from "../lib/library";
import { entriesRequest, type FixMatchRequest } from "../lib/matchOverrides";
import { badReleases } from "../lib/badReleases";
import { fakeMessage, isFakeTransfer, reviewFinishedDownload } from "../lib/fakeDownloads";
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
  const [cardMenu, setCardMenu] = useState<{ entries: LibraryEntry[]; label: string; place: MenuPlace } | null>(null);
  const [fixing, setFixing] = useState<FixMatchRequest | null>(null);
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
              const label = first.match?.title ?? first.name;
              // Fix Match: a movie or file card is one file; a show card is all its files.
              const more = (
                <button type="button" className="round-button library-card-more" aria-label={`More for ${label}`} aria-haspopup="menu"
                  aria-expanded={cardMenu?.entries[0].id === first.id}
                  onClick={(e) => { const place = placeUnder(e.currentTarget); setCardMenu((open) => (open?.entries[0].id === first.id ? null : { entries: g, label, place })); }}>
                  <MoreIcon size={18} />
                </button>
              );
              if (first.match?.kind === "tv") {
                const item = { tmdbID: first.match.tmdbID, kind: "tv" as const, title: first.match.title };
                // Every episode in put.io watched.
                const allWatched = g.every((e) => lib.isWatched(e.id) && lib.resumeSeconds(e) < 30);
                return (
                  <div key={`tv-${first.match.tmdbID}`} className="library-card">
                    <Link to={titlePath(item)} className="card">
                      <Poster path={first.match.posterPath} title={first.match.title}><span className="count-badge">{g.length}</span>{allWatched && <WatchedChip />}</Poster>
                      <span className="card-caption">{first.match.title} · {g.length} episode{g.length === 1 ? "" : "s"}</span>
                    </Link>
                    {more}
                  </div>
                );
              }
              return <div key={first.id} className="library-card"><EntryCard entry={first} />{more}</div>;
            })}
          </div>
        </section>

        {cardMenu && (
          <Menu label={`Actions for ${cardMenu.label}`} place={cardMenu.place} onClose={() => setCardMenu(null)}
            items={[{ label: "Fix Match…", onSelect: () => setFixing(entriesRequest(cardMenu.entries)) }]} />
        )}
        {fixing && <FixMatchDialog request={fixing} onClose={() => setFixing(null)} />}

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
  // Finished downloads the app sent are looked through once: a fake (a program, or no video) is removed.
  const doneSince = useRef(new Map<number, number>());
  const reviewing = useRef(new Set<number>());
  const reviewed = useRef(new Set<number>());
  const [, setFakesFound] = useState(0);
  const bad = badReleases();

  // A transfer that finishes adds files: read the library again (once per transfer).
  useEffect(() => {
    const done = (transfers.data ?? []).filter(isDone).map((t) => t.id).filter((id) => !finished.current.has(id));
    if (!done.length) return;
    const first = finished.current.size === 0;
    done.forEach((id) => finished.current.add(id));
    if (!first) void refreshLibrary(putio);
  }, [transfers.data, putio]);

  useEffect(() => {
    for (const t of (transfers.data ?? []).filter(isDone)) {
      const p = pending.find((x) => x.transferID === t.id);
      if (!p || reviewed.current.has(t.id) || reviewing.current.has(t.id) || isFakeTransfer(t, p, bad)) continue;
      if (!doneSince.current.has(t.id)) doneSince.current.set(t.id, Date.now());
      reviewing.current.add(t.id);
      void reviewFinishedDownload(putio, t, p, doneSince.current.get(t.id)!).then((result) => {
        reviewing.current.delete(t.id);
        if (result === "wait") return;
        reviewed.current.add(t.id);
        if (result === "fake") {
          toast(fakeMessage);
          setFakesFound((n) => n + 1);
          void refreshLibrary(putio);
        }
      });
    }
    // `pending` and `bad` are read fresh from storage each render; the poll drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          const fake = isDone(t) && isFakeTransfer(t, p, bad);
          const done = isDone(t) && !fake;
          const label = p ? `${p.title}${p.episode !== undefined ? ` · S${p.season} E${p.episode}` : p.season !== undefined ? ` · Season ${p.season}` : ""}` : t.name ?? "Transfer";
          const status = fake ? fakeMessage : done ? "Ready to watch" : isFailed(t) ? t.error_message || "Didn't download" : [`${t.percent_done ?? 0}%`, speed(t.down_speed)].filter(Boolean).join(" · ");
          return (
            <div key={t.id} className="transfer">
              {p?.posterPath ? <img src={image(p.posterPath, "w185")} alt="" /> : <div className="transfer-fallback" />}
              <div className="transfer-text">
                <div className="strong clamp-1">{label}</div>
                <div className={done ? "small good" : fake || isFailed(t) ? "small error-text" : "small muted"}>{status}</div>
                {fake && p && p.tmdbID > 0 && <Link to={titlePath({ kind: p.kind, tmdbID: p.tmdbID })} className="small">Choose Another Version</Link>}
                {!done && !fake && !isFailed(t) && <div className="meter meter-thin"><div className="meter-fill" style={{ width: `${t.percent_done ?? 0}%` }} /></div>}
              </div>
              {done && t.file_id ? (
                // A whole season arrives as a folder: open it in Files.
                p?.season !== undefined && p.episode === undefined
                  ? <Link to={`/files/${t.file_id}`} className="round-button round-primary" aria-label={`Open ${label}`}><FolderIcon /></Link>
                  : <Link to={playPath(t.file_id)} className="round-button round-primary" aria-label={`Play ${label}`}><PlayIcon /></Link>
              ) : null}
              <button type="button" className="round-button round-quiet" aria-label={done || fake ? `Remove ${label} from this list` : `Cancel ${label}`} onClick={() => void cancel(t)}><CloseIcon /></button>
            </div>
          );
        })}
      </div>
      {transfers.isError && <p className="error-text small">Couldn't read transfers from put.io.</p>}
    </section>
  );
}
