import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { image, type CatalogItem } from "../api/tmdb";
import type { PutioClient, PutioTransfer } from "../api/putio";
import { bytes } from "../lib/format";
import { library } from "../lib/library";
import { candidateDetail, freedBy, requiredSpace, shortfall, type RoomCandidate, type RoomRules } from "../lib/makeRoom";
import { canMakeRoom, deleteForRoom, freeSpace, neededFor, offerExplanation, offerMessage, offerTitle, planFor, purgeForRoom, type RoomOffer, type RoomStep } from "../lib/makeRoomRun";
import { loadSettings } from "../lib/settings";
import { keys, readJSON } from "../lib/storage";
import { refreshLibrary } from "../state/hooks";
import { CloseIcon } from "./Icons";
import "../styles/makeroom.css";

/** A Get the user chose not to make room for (or couldn't): nothing was sent, and it was already said why. */
export class NotEnoughSpace extends Error {}

/** Folders running downloads save into (never deleted to make room). */
async function busyFolders(putio: PutioClient): Promise<number[]> {
  const transfers: PutioTransfer[] = await putio.transfers().catch(() => []);
  return transfers.filter((t) => !["COMPLETED", "SEEDING", "ERROR"].includes(t.status ?? "") && t.save_parent_id !== undefined).map((t) => t.save_parent_id!);
}

/** The offer for a download of `size` that doesn't fit (free space read fresh); undefined when it fits, or the size
 * or free space is unknown. */
export async function roomOffer(putio: PutioClient, size: number | undefined, target: { title: string; kind: CatalogItem["kind"]; tmdbID: number; season?: number; episode?: number }): Promise<RoomOffer | undefined> {
  if (size === undefined) return undefined;
  const avail = await freeSpace(putio);
  const missing = shortfall(size, avail);
  if (missing === undefined || avail === undefined) return undefined;
  const title = offerTitle(target.title, target.kind, target.season, target.episode);
  if (!loadSettings().makeRoom) return { title, size, avail };
  const goal: RoomRules["target"] = { tmdbID: target.tmdbID, kind: target.kind, season: target.season };
  const plan = await planFor(putio, missing, {
    entries: library.entries, isWatched: (id) => library.isWatched(id), resumeSeconds: (e) => library.resumeSeconds(e),
    myList: readJSON<CatalogItem[]>(keys.myList, []), target: goal, busyFolders: await busyFolders(putio),
  });
  return { title, size, avail, plan };
}

/** Shows the make-room question over the page. Resolves with what to tell the user once room was made and `run`
 * (the send or retry) went through; undefined when the user cancelled or it couldn't be done. */
export function askToMakeRoom(offer: RoomOffer, putio: PutioClient, run: () => Promise<unknown>): Promise<string | undefined> {
  return new Promise((resolve) => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const root = createRoot(element);
    const close = (result?: string) => { root.unmount(); element.remove(); resolve(result); };
    root.render(<StrictMode><MakeRoomDialog offer={offer} putio={putio} run={run} onClose={close} /></StrictMode>);
  });
}

/** For a transfer put.io stopped for lack of space: makes room (asking first) and retries it. Returns the message. */
export async function retryMakingRoom(putio: PutioClient, transfer: PutioTransfer, target: { title: string; kind: CatalogItem["kind"]; tmdbID: number; season?: number; episode?: number }): Promise<string> {
  if (!transfer.size) return "put.io ran out of space for this download. Free up some space, then try again.";
  const offer = await roomOffer(putio, transfer.size, target);
  if (!offer) {
    await putio.retryTransfer(transfer.id);
    return `Trying ${target.title} again`;
  }
  return (await askToMakeRoom(offer, putio, () => putio.retryTransfer(transfer.id))) ?? `${target.title} wasn't retried.`;
}

type Phase = { kind: "choosing" } | { kind: "working"; text: string } | { kind: "trash"; step: Extract<RoomStep, { kind: "trash" }> } | { kind: "failed"; message: string };

function MakeRoomDialog({ offer, putio, run, onClose }: { offer: RoomOffer; putio: PutioClient; run: () => Promise<unknown>; onClose: (result?: string) => void }) {
  const [selection, setSelection] = useState(() => new Set(offer.plan?.suggested ?? []));
  const [phase, setPhase] = useState<Phase>({ kind: "choosing" });
  const changed = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const required = requiredSpace(offer.size);
  const needed = neededFor(offer);
  const freed = offer.plan ? freedBy(offer.plan, selection) : 0;
  const working = phase.kind === "working";
  const canDelete = phase.kind === "choosing" && canMakeRoom(offer) && selection.size > 0 && freed >= needed;
  const explanation = offerExplanation(offer);

  const close = (result?: string) => {
    if (working) return;
    // Something went: the library reads put.io again (what went is already off the screen).
    if (changed.current) void refreshLibrary(putio, true);
    onClose(result);
  };

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function toggle(id: number) {
    if (phase.kind !== "choosing") return;
    const next = new Set(selection);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelection(next);
  }

  async function after(step: RoomStep) {
    if (step.forgotten.length) { library.forget(step.forgotten); changed.current = true; }
    if (step.kind === "trash") { setPhase({ kind: "trash", step }); return; }
    if (step.kind === "failed") { setPhase({ kind: "failed", message: step.message }); return; }
    setPhase({ kind: "working", text: "Sending to put.io…" });
    try {
      await run();
    } catch {
      setPhase({ kind: "failed", message: `Made room, but couldn't send ${offer.title} to put.io. Try Get again.` });
      return;
    }
    if (changed.current) void refreshLibrary(putio, true);
    onClose(`Freed ${bytes(step.freed)} · Getting ${offer.title}`);
  }

  async function confirm() {
    if (!canDelete || !offer.plan) return;
    setPhase({ kind: "working", text: "Deleting…" });
    await after(await deleteForRoom(putio, offer.plan, selection, required, offer.title));
  }

  async function purge() {
    if (phase.kind !== "trash") return;
    setPhase({ kind: "working", text: "Deleting from Trash…" });
    await after(await purgeForRoom(putio, phase.step, required, offer.title));
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => close()}>
      <div className="dialog dialog-small make-room" role="dialog" aria-modal="true" aria-label="Not enough space on put.io" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div>
            <div className="eyebrow">MAKE ROOM</div>
            <h2>Not enough space on put.io</h2>
          </div>
          <button ref={closeButton} type="button" className="icon-button" aria-label="Cancel" disabled={working} onClick={() => close()}><CloseIcon /></button>
        </div>
        <p>{offerMessage(offer)}</p>

        {phase.kind === "choosing" && (
          <>
            {explanation ? <p className="error-text">{explanation}</p> : <p className="muted">Delete these to make room? Watched titles go first, then the oldest.</p>}
            {!explanation && (
              <ul className="make-room-list">
                {offer.plan!.candidates.map((c) => <CandidateRow key={c.id} candidate={c} selected={selection.has(c.id)} onToggle={() => toggle(c.id)} />)}
              </ul>
            )}
            {explanation ? (
              <div className="make-room-actions"><button type="button" className="pill pill-primary" onClick={() => close()}>OK</button></div>
            ) : (
              <>
                <div className="make-room-total small">
                  <span className={freed >= needed ? "good" : "error-text"}>Frees {bytes(freed)}</span>
                  <span className="muted">Needs {bytes(needed)}</span>
                </div>
                <div className="make-room-actions">
                  <button type="button" className="pill" onClick={() => close()}>Cancel</button>
                  <button type="button" className="pill pill-primary pill-danger-text" disabled={!canDelete} onClick={() => void confirm()}>Delete &amp; Get</button>
                </div>
                <p className="muted small">Deleted files go to put.io's Trash first.</p>
              </>
            )}
          </>
        )}

        {phase.kind === "working" && <p className="muted" role="status">{phase.text}</p>}

        {phase.kind === "trash" && (
          <>
            <p>These are in put.io's Trash and still use space. Delete them permanently?</p>
            <ul className="make-room-list">
              {phase.step.items.map((i) => <li key={i.id} className="make-room-trash small"><span className="clamp-1">{i.name}</span><span className="muted">{bytes(i.size)}</span></li>)}
            </ul>
            <div className="make-room-actions">
              <button type="button" className="pill" onClick={() => setPhase({ kind: "failed", message: `They're in put.io's Trash, and put.io still counts them, so ${offer.title} wasn't sent. You can restore them from Files → Trash.` })}>Keep in Trash</button>
              <button type="button" className="pill pill-primary pill-danger-text" onClick={() => void purge()}>Delete Permanently</button>
            </div>
          </>
        )}

        {phase.kind === "failed" && (
          <>
            <p className="error-text">{phase.message}</p>
            <div className="make-room-actions"><button type="button" className="pill pill-primary" onClick={() => close()}>OK</button></div>
          </>
        )}
      </div>
    </div>
  );
}

function CandidateRow({ candidate: c, selected, onToggle }: { candidate: RoomCandidate; selected: boolean; onToggle: () => void }) {
  const detail = candidateDetail(c);
  const added = c.addedAt !== undefined ? ` · Added ${new Date(c.addedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}` : "";
  return (
    <li>
      <label className="make-room-row">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Delete ${c.title}${detail ? ` ${detail}` : ""}`} />
        {c.posterPath ? <img src={image(c.posterPath, "w185")} alt="" /> : <div className="make-room-poster" />}
        <span className="make-room-text">
          <span className="strong clamp-1">{c.title}</span>
          {detail && <span className="small">{detail}</span>}
          <span className="small muted">{c.watched ? "Watched" : "Not watched yet"}{added}</span>
        </span>
        <span className="small strong">{bytes(c.size)}</span>
      </label>
    </li>
  );
}
