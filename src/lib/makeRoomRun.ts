/** Making room on put.io, against put.io (the native apps' RoomKeeper / RoomSession): reads what could go, deletes
 * exactly what the user confirmed, and, when put.io still counts the deleted items in its Trash, removes exactly those
 * from the Trash after asking again. The whole Trash is never emptied. */
import { isFolder, isVideo, type PutioClient, type PutioFile, type PutioTrashFile } from "../api/putio";
import type { CatalogItem, MediaKind } from "../api/tmdb";
import { bytes } from "./format";
import type { LibraryEntry } from "./library";
import { availableToFree, chosen, isSkippedFolder, myListKey, planRoom, requiredSpace, type RoomPlan, type RoomRules } from "./makeRoom";
import { defaultFolders, sameName } from "./folders";

export type RoomPutio = Pick<PutioClient, "account" | "list" | "deleteFiles" | "trash" | "deleteFromTrash">;

/** A download that doesn't fit, with what could be deleted to make room for it. */
export interface RoomOffer {
  /** What's being got: "Dune: Part Two", "Severance · Season 2". */
  title: string;
  size: number;
  /** put.io's free space when it was checked. */
  avail: number;
  /** Undefined when making room is turned off in Settings. */
  plan?: RoomPlan;
}

export const neededFor = (offer: Pick<RoomOffer, "size" | "avail">) => Math.max(requiredSpace(offer.size) - offer.avail, 0);
export const canMakeRoom = (offer: RoomOffer) => Boolean(offer.plan && availableToFree(offer.plan) >= offer.plan.needed && offer.plan.needed > 0);
export const offerMessage = (offer: RoomOffer) => `${offer.title} needs ${bytes(offer.size)}, you have ${bytes(Math.max(offer.avail, 0))} free.`;

/** Why nothing is offered for deleting, when nothing is. */
export function offerExplanation(offer: RoomOffer): string | undefined {
  if (!offer.plan) return "Free up space in put.io, or turn on making room in Settings → Smart Get.";
  if (canMakeRoom(offer)) return undefined;
  if (!offer.plan.candidates.length) return "Nothing in Movies or TV Series can go: what's left is being watched, on My List, or what you're getting.";
  return `Deleting everything that can go in Movies and TV Series would free only ${bytes(availableToFree(offer.plan))}. Nothing was deleted.`;
}

export function offerTitle(title: string, kind: MediaKind, season?: number, episode?: number): string {
  if (season !== undefined && episode !== undefined) return `${title} · S${season} E${episode}`;
  if (season !== undefined && kind === "tv") return `${title} · Season ${season}`;
  return title;
}

/** put.io's free space, read fresh; undefined when put.io doesn't say. */
export async function freeSpace(putio: Pick<PutioClient, "account">): Promise<number | undefined> {
  try {
    return (await putio.account()).disk?.avail;
  } catch {
    return undefined;
  }
}

/** The top-level Movies and TV Series folders and every folder inside them (read fresh from put.io). */
export async function readRoomFolders(putio: Pick<PutioClient, "list">, topLevel: string[] = [defaultFolders.movies, defaultFolders.tv]): Promise<PutioFile[]> {
  const top = (await putio.list(0)).files.filter((f) => isFolder(f) && topLevel.some((n) => sameName(n, f.name)));
  const found: PutioFile[] = top.map((f) => ({ ...f, parent_id: 0 }));
  let queue = top.map((f) => f.id);
  let read = 0;
  while (queue.length && read < 2000) {
    const batch = queue.splice(0, 6);
    read += batch.length;
    const lists = await Promise.all(batch.map((id) => putio.list(id).catch(() => ({ files: [] as PutioFile[] }))));
    lists.forEach((list, i) => {
      for (const f of list.files.filter(isFolder)) {
        found.push({ ...f, parent_id: f.parent_id ?? batch[i] });
        if (!isSkippedFolder(f.name)) queue.push(f.id);
      }
    });
    queue = [...new Set(queue)];
  }
  return found;
}

export interface PlanInputs {
  entries: LibraryEntry[];
  isWatched: (fileID: number) => boolean;
  resumeSeconds: (entry: LibraryEntry) => number;
  myList: CatalogItem[];
  target?: RoomRules["target"];
  /** Folders running downloads save into. */
  busyFolders?: number[];
}

/** What could go to free `needed` bytes. */
export async function planFor(putio: Pick<PutioClient, "list">, needed: number, inputs: PlanInputs): Promise<RoomPlan> {
  const folders = await readRoomFolders(putio);
  return planRoom(needed, inputs.entries, folders, {
    watched: new Set(inputs.entries.filter((e) => inputs.isWatched(e.id)).map((e) => e.id)),
    positions: new Map(inputs.entries.map((e) => [e.id, inputs.resumeSeconds(e)])),
    myList: new Set(inputs.myList.map((i) => myListKey(i.kind, i.tmdbID))),
    target: inputs.target,
    busyFolders: new Set(inputs.busyFolders ?? []),
  });
}

/** Whether every video in the folder (at any depth) is one the plan counted. A folder put.io can't list fails. */
export async function holdsOnly(putio: Pick<PutioClient, "list">, folderID: number, known: number[]): Promise<boolean> {
  const allowed = new Set(known);
  const queue = [folderID];
  let listed = 0;
  while (queue.length) {
    if (++listed > 200) return false;
    let files: PutioFile[];
    try {
      files = (await putio.list(queue.pop()!)).files;
    } catch {
      return false;
    }
    for (const f of files) {
      if (isFolder(f)) { if (!isSkippedFolder(f.name)) queue.push(f.id); } else if (isVideo(f) && !/\bsample\b/i.test(f.name) && !allowed.has(f.id)) return false;
    }
  }
  return true;
}

export type RoomStep =
  /** put.io has the room: send the download. */
  | { kind: "ready"; freed: number; deletedIDs: number[]; forgotten: number[] }
  /** Deleted, but put.io still counts these Trash items: ask before removing them for good. */
  | { kind: "trash"; freed: number; deletedIDs: number[]; forgotten: number[]; items: PutioTrashFile[] }
  | { kind: "failed"; message: string; freed: number; deletedIDs: number[]; forgotten: number[] };

const BATCH = 20;

/** Deletes exactly the confirmed candidates (after checking each folder still holds only what the library knew),
 * then checks put.io's free space against `required`. */
export async function deleteForRoom(putio: RoomPutio, plan: RoomPlan, selection: ReadonlySet<number>, required: number, title: string): Promise<RoomStep> {
  const picked = chosen(plan, selection);
  for (const c of picked.filter((c) => c.isFolder)) {
    if (!(await holdsOnly(putio, c.id, c.fileIDs))) {
      return { kind: "failed", message: `“${c.name}” changed since the library was last read. Nothing was deleted. Update the library and try again.`, freed: 0, deletedIDs: [], forgotten: [] };
    }
  }
  const deleted: typeof picked = [];
  for (let i = 0; i < picked.length; i += BATCH) {
    const batch = picked.slice(i, i + BATCH);
    try {
      await putio.deleteFiles(batch.map((c) => c.id));
      deleted.push(...batch);
    } catch {
      return {
        kind: "failed", message: `put.io stopped answering after ${deleted.length} of ${picked.length} deletions. ${title} wasn't sent.`,
        freed: sum(deleted), deletedIDs: deleted.map((c) => c.id), forgotten: deleted.flatMap((c) => c.fileIDs),
      };
    }
  }
  const done = { freed: sum(deleted), deletedIDs: deleted.map((c) => c.id), forgotten: deleted.flatMap((c) => c.fileIDs) };
  return afterDeleting(putio, done, required, title, false);
}

/** Removes exactly the deleted items from put.io's Trash (never anything else), then checks the free space again. */
export async function purgeForRoom(putio: RoomPutio, step: Extract<RoomStep, { kind: "trash" }>, required: number, title: string): Promise<RoomStep> {
  const deleted = new Set(step.deletedIDs);
  const ids = step.items.map((i) => i.id).filter((id) => deleted.has(id));
  const done = { freed: step.freed, deletedIDs: step.deletedIDs, forgotten: step.forgotten };
  for (let i = 0; i < ids.length; i += BATCH) {
    try {
      await putio.deleteFromTrash(ids.slice(i, i + BATCH));
    } catch {
      return { kind: "failed", message: `Couldn't delete them from put.io's Trash. ${title} wasn't sent.`, ...done };
    }
  }
  return afterDeleting(putio, done, required, title, true);
}

async function afterDeleting(putio: RoomPutio, done: { freed: number; deletedIDs: number[]; forgotten: number[] }, required: number, title: string, trashPurged: boolean): Promise<RoomStep> {
  const avail = await freeSpace(putio);
  // put.io not answering: let the download try (put.io decides).
  if (avail === undefined || avail >= required) return { kind: "ready", ...done };
  if (!trashPurged) {
    const deleted = new Set(done.deletedIDs);
    const items = ((await putio.trash().catch(() => undefined))?.files ?? []).filter((f) => deleted.has(f.id));
    if (items.length) return { kind: "trash", items, ...done };
  }
  return { kind: "failed", message: `Deleted ${bytes(done.freed)}, but put.io still shows only ${bytes(avail)} free, so ${title} wasn't sent. Try again in a few minutes.`, ...done };
}

const sum = (items: { size: number }[]) => items.reduce((total, c) => total + c.size, 0);
