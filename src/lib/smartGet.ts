/** Get & Watch: picks the release Smart Get sends (the iPhone app's SmartPicker) and sends it to put.io, into the
 * folders picked in Settings (default Movies and TV Series/<Show>/Season N at the top of put.io, as in the iPhone
 * app). */
import type { Release } from "../api/sources/types";
import type { PutioClient, PutioTransfer } from "../api/putio";
import { defaultFolders, findFolder } from "./folders";
import type { MediaKind } from "../api/tmdb";
import { loadSettings, type AppSettings, type SmartGetRule } from "./settings";
import { readJSON, writeJSON } from "./storage";

/** The preferred quality with the most seeders; else the nearest lower one; else the nearest higher one; unknown
 * quality last. Never a camera recording, never one bigger than the size cap (unknown sizes are allowed), never a
 * release nobody seeds (unless no release says how many seed it). "Best" (null) prefers 8K and works down. */
export function pickRelease(releases: Release[], rule: SmartGetRule): Release | undefined {
  const cap = rule.maxSizeGB !== null ? rule.maxSizeGB * 1_000_000_000 : undefined;
  const usable = releases.filter((r) => r.parsed.source !== "CAM" && (cap === undefined || r.sizeBytes === undefined || r.sizeBytes <= cap));
  const seeded = usable.filter((r) => (r.seeders ?? 0) > 0);
  const pool = seeded.length ? seeded : usable.filter((r) => r.seeders === undefined);
  const preferred = rule.resolution ?? 4320;
  const priority = (r: Release) => {
    const res = r.parsed.resolution;
    if (res === preferred) return 0;
    if (res === 0) return 10_000;
    return res < preferred ? 10 + (preferred - res) : 5_000 + (res - preferred);
  };
  return [...pool].sort((a, b) => priority(a) - priority(b) || (b.seeders ?? 0) - (a.seeders ?? 0))[0];
}

type FolderSettings = Pick<AppSettings, "moviesFolder" | "tvFolder" | "seasonFolders">;

export const defaultMoviesPath: string[] = [defaultFolders.movies];
export const defaultTVPath: string[] = [defaultFolders.tv];

/** put.io folder names can't contain "/" (the iPhone app's rule, so both apps find the same show folder). */
export function folderName(title: string): string {
  const cleaned = title.replace(/\//g, "-").trim();
  return cleaned || "Untitled";
}

/** Where a download goes: a base folder (picked in Settings by id, else created from the root) and the folders
 * below it, the show and, when season folders are on, "Season N". */
export function destination(folders: FolderSettings, kind: MediaKind, title: string, season?: number): { rootID: number; path: string[] } {
  const below = kind === "tv" ? (folders.seasonFolders && season !== undefined ? [folderName(title), `Season ${season}`] : [folderName(title)]) : [];
  const picked = kind === "tv" ? folders.tvFolder : folders.moviesFolder;
  if (picked) return { rootID: picked.id, path: below };
  return { rootID: 0, path: [...(kind === "tv" ? defaultTVPath : defaultMoviesPath), ...below] };
}

/** "TV Series/Severance/Season 2", for Settings and messages. */
export function displayPath(folders: FolderSettings, kind: MediaKind, title: string, season?: number): string {
  const picked = kind === "tv" ? folders.tvFolder : folders.moviesFolder;
  const defaultPath = kind === "tv" ? defaultTVPath : defaultMoviesPath;
  const base = picked?.path ?? defaultPath.join("/");
  return [base, ...destination(folders, kind, title, season).path.slice(picked ? 0 : defaultPath.length)].join("/");
}

/** The default folders, for code that only knows a kind and title. */
export function folderPath(kind: MediaKind, title: string, season?: number): string[] {
  return destination({ moviesFolder: null, tvFolder: null, seasonFolders: true }, kind, title, season).path;
}

/** Finds or creates `path` inside folder `rootID` and returns the last folder's id. Existing folders are found
 * ignoring case ("tv series" counts as "TV Series"). */
export async function ensureFolder(putio: Pick<PutioClient, "list" | "createFolder">, rootID: number, path: string[]): Promise<number> {
  let parent = rootID;
  for (const name of path) {
    const { files } = await putio.list(parent);
    const existing = findFolder(files, name);
    parent = existing ? existing.id : (await putio.createFolder(name, parent)).id;
  }
  return parent;
}

export interface PendingTransfer {
  transferID: number;
  tmdbID: number;
  kind: MediaKind;
  title: string;
  season?: number;
  episode?: number;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseName: string;
  addedAt: number;
}

const PENDING_KEY = "pc.transfers.v1";
export const pendingTransfers = (): PendingTransfer[] => readJSON<PendingTransfer[]>(PENDING_KEY, []);
export const savePendingTransfers = (list: PendingTransfer[]) => writeJSON(PENDING_KEY, list);

export async function sendToPutio(
  putio: PutioClient,
  release: Release,
  target: Omit<PendingTransfer, "transferID" | "releaseName" | "addedAt">,
  folders: FolderSettings = loadSettings(),
): Promise<PutioTransfer> {
  const { rootID, path } = destination(folders, target.kind, target.title, target.season);
  let parent: number;
  try {
    parent = await ensureFolder(putio, rootID, path);
  } catch (error) {
    // The folder picked in Settings was deleted or moved out of reach.
    if (rootID !== 0 && error instanceof Error && "status" in error && (error as { status: number }).status === 404) {
      throw new Error(`The ${target.kind === "tv" ? "TV" : "Movies"} folder picked in Settings is gone. Pick another in Settings → put.io Folders.`);
    }
    throw error;
  }
  const transfer = await putio.addTransfer(release.link, parent);
  savePendingTransfers([{ ...target, transferID: transfer.id, releaseName: release.name, addedAt: Date.now() }, ...pendingTransfers()].slice(0, 50));
  return transfer;
}
