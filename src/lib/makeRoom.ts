/** Making room on put.io when a download doesn't fit (the native apps' MakeRoom.swift): the fit check, put.io's
 * out-of-space wording, and the plan of what could be deleted. Pure, so every rule is tested without put.io.
 *
 * Rules: only what's inside the top-level Movies and TV Series folders; never a title being watched (a position of
 * 30 s or more and not watched to the end), on My List, or the one being got (for a show, the season being got);
 * never a folder a download is saving into. A folder goes whole only when all the library's videos in it are one
 * movie or one season (and it holds no folder the library knows nothing about); otherwise each video goes alone.
 * Watched ones go first, then unwatched; oldest added first within each. */
import type { PutioFile } from "../api/putio";
import type { MediaKind } from "../api/tmdb";
import { defaultFolders, sameName } from "./folders";
import type { LibraryEntry } from "./library";
import { STARTED_SECONDS } from "./watched";

/** Free space must cover the download plus this many percent of it: release sizes are rounded, and a torrent
 * brings subtitles and artwork along. */
export const MARGIN_PERCENT = 2;

/** The free space a download of `size` needs (whole bytes, rounded up). */
export const requiredSpace = (size: number) => size + Math.ceil((size * MARGIN_PERCENT) / 100);

/** Bytes still missing for a download of `size` to fit in `avail`; undefined when it fits, or when either is unknown
 * (an unknown size is never checked: the download is sent and put.io decides). */
export function shortfall(size: number | undefined, avail: number | undefined): number | undefined {
  if (size === undefined || !(size > 0) || avail === undefined) return undefined;
  const missing = requiredSpace(size) - avail;
  return missing > 0 ? missing : undefined;
}

const OUT_OF_SPACE = [
  /\b(not enough|insufficient|no|out of|lack of|low on)\b[^.]{0,20}\b(space|storage|disk|quota)\b/i,
  /\b(disk|storage|space|quota)\b[^.]{0,20}\b(full|exceeded|exhausted|used up)\b/i,
  /\bexceed(s|ed|ing)?\b[^.]{0,30}\b(space|storage|disk|quota)\b/i,
];

/** put.io's wording for a transfer that failed because the account is full. It isn't documented, so this matches
 * leniently: "not enough (disk) space", "insufficient storage", "no space left", "disk full", "quota exceeded"… */
export const isOutOfSpace = (message?: string | null) => Boolean(message) && OUT_OF_SPACE.some((re) => re.test(message!));

export type CandidateKind = "movie" | "season" | "episode" | "other";

/** One thing that can go: a movie (its folder, or the file when it sits loose), a season (its folder), or one
 * episode (when its season has no folder of its own). */
export interface RoomCandidate {
  /** The put.io file or folder that is deleted. */
  id: number;
  isFolder: boolean;
  /** Its name in put.io. */
  name: string;
  title: string;
  posterPath?: string | null;
  kind: CandidateKind;
  season?: number;
  episode?: number;
  size: number;
  /** Every video in it was watched to the end. */
  watched: boolean;
  /** When put.io got it (ms), from the folder's or file's created date. */
  addedAt?: number;
  /** The library's videos inside (checked again before deleting). */
  fileIDs: number[];
}

export interface RoomPlan {
  /** Bytes to free. */
  needed: number;
  /** Everything allowed to go, in the order it goes. */
  candidates: RoomCandidate[];
  /** The fewest candidates from the front that free `needed`; empty when even all of them can't. */
  suggested: number[];
}

export interface RoomRules {
  /** Files watched to the end. */
  watched: ReadonlySet<number>;
  /** Resume positions in seconds (a file not here uses put.io's list value). */
  positions: ReadonlyMap<number, number>;
  /** My List, as "movie-603" / "tv-1399". */
  myList: ReadonlySet<string>;
  /** What's being got: the same movie, or the same show's season, is kept. */
  target?: { tmdbID: number; kind: MediaKind; season?: number };
  /** Folders downloads are saving into: they, and the folders holding them, are kept. */
  busyFolders?: ReadonlySet<number>;
  topLevelFolders?: string[];
}

const SKIPPED_FOLDERS = new Set(["subs", "subtitles", "sub", "sample", "samples", "screens", "screenshots", "proof", "artwork", "covers"]);
export const isSkippedFolder = (name: string) => SKIPPED_FOLDERS.has(name.trim().toLowerCase());

/** put.io's dates are UTC without a zone ("2026-10-10T10:00:00"). */
export function putioDate(text?: string): number | undefined {
  if (!text) return undefined;
  const time = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(time) ? undefined : time;
}

export const myListKey = (kind: MediaKind, tmdbID: number) => `${kind}-${tmdbID}`;

/** Videos of one movie, or of one season of a show, share a key; a video with no match is its own. */
function groupKey(entry: LibraryEntry): string {
  const m = entry.match;
  if (!m) return `file-${entry.id}`;
  return m.kind === "tv" ? `tv-${m.tmdbID}-s${m.season ?? -1}` : `${m.kind}-${m.tmdbID}`;
}

function isInProgress(entry: LibraryEntry, rules: RoomRules) {
  const seconds = rules.positions.get(entry.id) ?? entry.startFrom ?? 0;
  return seconds >= STARTED_SECONDS && !rules.watched.has(entry.id);
}

function isTarget(entry: LibraryEntry, rules: RoomRules) {
  const t = rules.target, m = entry.match;
  if (!t || !m || !(t.tmdbID > 0) || m.tmdbID !== t.tmdbID || m.kind !== t.kind) return false;
  if (t.kind !== "tv" || t.season === undefined || m.season === undefined) return true;
  return t.season === m.season;
}

/** Watched before unwatched; within each, oldest added first (no date: last); then by id. */
function deletedFirst(a: RoomCandidate, b: RoomCandidate): number {
  if (a.watched !== b.watched) return a.watched ? -1 : 1;
  if (a.addedAt !== undefined && b.addedAt !== undefined && a.addedAt !== b.addedAt) return a.addedAt - b.addedAt;
  if (a.addedAt !== undefined && b.addedAt === undefined) return -1;
  if (a.addedAt === undefined && b.addedAt !== undefined) return 1;
  return a.id - b.id;
}

/** Everything allowed to go, in order. `folders`: every folder inside Movies and TV Series (and those two). */
export function roomCandidates(entries: LibraryEntry[], folders: PutioFile[], rules: RoomRules): RoomCandidate[] {
  const byID = new Map(folders.map((f) => [f.id, f]));
  const childFolders = new Map<number, PutioFile[]>();
  for (const f of folders) {
    if (f.parent_id === undefined) continue;
    childFolders.set(f.parent_id, [...(childFolders.get(f.parent_id) ?? []), f]);
  }
  const topLevel = rules.topLevelFolders ?? [defaultFolders.movies, defaultFolders.tv];
  const roots = new Set(folders.filter((f) => (f.parent_id ?? 0) === 0 && topLevel.some((n) => sameName(n, f.name))).map((f) => f.id));

  // Each video's folders below Movies / TV Series, nearest first; undefined when it isn't inside one of them.
  const chain = (entry: LibraryEntry): number[] | undefined => {
    const path: number[] = [];
    let current = entry.parentID;
    while (current !== undefined && path.length < 64) {
      if (roots.has(current)) return path;
      const folder = byID.get(current);
      if (current === 0 || !folder) return undefined;
      path.push(current);
      current = folder.parent_id;
    }
    return undefined;
  };

  const chains = new Map<number, number[]>();
  const keysUnder = new Map<number, Set<string>>();
  for (const entry of entries) {
    const path = chain(entry);
    if (!path) continue;
    chains.set(entry.id, path);
    for (const id of path) keysUnder.set(id, (keysUnder.get(id) ?? new Set()).add(groupKey(entry)));
  }

  // Downloads' folders and every folder above them.
  const busy = new Set<number>();
  for (const id of rules.busyFolders ?? []) {
    let current: number | undefined = id;
    while (current !== undefined && current !== 0 && !busy.has(current)) {
      busy.add(current);
      current = byID.get(current)?.parent_id;
    }
  }

  // Every folder inside holds library videos, or only subtitles / samples / artwork.
  const onlyKnownFolders = (id: number, depth = 0): boolean =>
    depth < 32 && (childFolders.get(id) ?? []).every((child) => isSkippedFolder(child.name) || (keysUnder.has(child.id) && onlyKnownFolders(child.id, depth + 1)));
  const wholeFolder = (id: number) => keysUnder.get(id)?.size === 1 && !busy.has(id) && onlyKnownFolders(id);

  // Group: the highest folder that is wholly this one movie or season, else the video itself.
  const groups = new Map<number, { isFolder: boolean; entries: LibraryEntry[] }>();
  for (const entry of entries) {
    const path = chains.get(entry.id);
    if (!path) continue;
    const folder = [...path].reverse().find(wholeFolder);
    const id = folder ?? entry.id;
    if (!groups.has(id)) groups.set(id, { isFolder: folder !== undefined, entries: [] });
    groups.get(id)!.entries.push(entry);
  }

  const candidates: RoomCandidate[] = [];
  for (const [id, group] of groups) {
    const items = group.entries;
    if (items.some((e) => isInProgress(e, rules) || isTarget(e, rules) || (e.match && rules.myList.has(myListKey(e.match.kind, e.match.tmdbID))))) continue;
    const folder = group.isFolder ? byID.get(id) : undefined;
    const file = items[0];
    const videos = items.reduce((sum, e) => sum + (e.size ?? 0), 0);
    const size = group.isFolder ? Math.max(folder?.size ?? 0, videos) : (file.size ?? 0);
    // Unknown size: deleting it can't be promised to help.
    if (!(size > 0)) continue;
    const match = items.find((e) => e.match)?.match;
    const kind: CandidateKind = match?.kind === "movie" ? "movie" : match?.kind === "tv" ? (group.isFolder ? "season" : "episode") : "other";
    const name = group.isFolder ? folder?.name ?? "" : file.name;
    candidates.push({
      id, isFolder: group.isFolder, name,
      title: match?.title ?? (group.isFolder ? name : name.replace(/\.[^.]+$/, "")),
      posterPath: match?.posterPath, kind,
      season: kind === "season" || kind === "episode" ? match?.season : undefined,
      episode: kind === "episode" ? match?.episode : undefined,
      size, watched: items.every((e) => rules.watched.has(e.id)),
      addedAt: putioDate(group.isFolder ? folder?.created_at : file.createdAt),
      fileIDs: items.map((e) => e.id),
    });
  }
  return candidates.sort(deletedFirst);
}

export function planRoom(needed: number, entries: LibraryEntry[], folders: PutioFile[], rules: RoomRules): RoomPlan {
  const candidates = roomCandidates(entries, folders, rules);
  const picked: number[] = [];
  let freed = 0;
  for (const c of candidates) {
    if (freed >= needed) break;
    picked.push(c.id);
    freed += c.size;
  }
  return { needed, candidates, suggested: freed >= needed ? picked : [] };
}

/** Everything allowed, together. */
export const availableToFree = (plan: RoomPlan) => plan.candidates.reduce((sum, c) => sum + c.size, 0);
/** The candidates picked in `selection`, in plan order (ids that aren't candidates are ignored). */
export const chosen = (plan: RoomPlan, selection: ReadonlySet<number>) => plan.candidates.filter((c) => selection.has(c.id));
export const freedBy = (plan: RoomPlan, selection: ReadonlySet<number>) => chosen(plan, selection).reduce((sum, c) => sum + c.size, 0);

/** "Season 2", "S2 E4", undefined for a movie. */
export function candidateDetail(c: Pick<RoomCandidate, "season" | "episode">): string | undefined {
  if (c.season !== undefined && c.episode !== undefined) return `S${c.season} E${c.episode}`;
  if (c.season !== undefined) return `Season ${c.season}`;
  return undefined;
}
