/** The put.io folders Get & Watch saves into by default: "Movies" and "TV Series" at the top of put.io (the iPhone
 * app's DefaultFolders). Builds before these used AMDB/Movies and AMDB/TV; folderMergeRun.ts moves those into these
 * once. */
import { isFolder, type PutioFile } from "../api/putio";
import type { PutioFolderRef } from "./settings";

export const defaultFolders = {
  movies: "Movies",
  tv: "TV Series",
  /** Where older builds saved: AMDB/Movies and AMDB/TV. */
  oldRoot: "AMDB",
  oldMovies: "Movies",
  oldTV: "TV",
} as const;

/** Folder names are compared ignoring case and surrounding spaces ("tv series" is "TV Series"). */
export const nameKey = (name: string) => name.trim().toLowerCase();
export const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);

/** The folder in `files` called `name`: the exact spelling first, else one that differs only in case or spaces. */
export function findFolder(files: PutioFile[], name: string): PutioFile | undefined {
  return files.find((f) => isFolder(f) && f.name === name) ?? files.find((f) => isFolder(f) && sameName(f.name, name));
}

/** Whether a folder picked in Settings is the old AMDB/Movies or AMDB/TV (by its path, or by an id known to be one of
 * them). Those picks go back to the defaults. */
export function isOldFolder(ref: PutioFolderRef, oldIDs: ReadonlySet<number> = new Set()): boolean {
  if (oldIDs.has(ref.id)) return true;
  const parts = ref.path.split("/").map(nameKey).filter(Boolean);
  return parts.length === 2 && parts[0] === nameKey(defaultFolders.oldRoot)
    && (parts[1] === nameKey(defaultFolders.oldMovies) || parts[1] === nameKey(defaultFolders.oldTV));
}
