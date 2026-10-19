/** What the library reads in put.io (the iPhone app's LibraryScope): everything inside the Movies and TV Series
 * folders at the top of put.io (and inside the folders picked in Settings, wherever they are), plus videos sitting
 * loose at the top. Other top-level folders aren't read, so they never show in Library, Recently Added or Continue
 * Watching. Files still shows everything. */
import type { PutioFile } from "../api/putio";
import { defaultFolders, sameName } from "./folders";
import type { AppSettings, PutioFolderRef } from "./settings";

export interface LibraryScope {
  /** Top-level folders read whole, matched ignoring case and surrounding spaces. */
  topLevelFolders: string[];
  /** Folders picked in Settings, read whole wherever they are (Get & Watch saves there). */
  pickedFolders: PutioFolderRef[];
}

export const standardScope: LibraryScope = { topLevelFolders: [defaultFolders.movies, defaultFolders.tv], pickedFolders: [] };

/** The default folders plus the ones picked in Settings. */
export function libraryScope(settings: Pick<AppSettings, "moviesFolder" | "tvFolder">): LibraryScope {
  return { ...standardScope, pickedFolders: [settings.moviesFolder, settings.tvFolder].filter((f): f is PutioFolderRef => f !== null) };
}

/** Whether a folder directly at the top of put.io is read. */
export function includesTopLevelFolder(scope: LibraryScope, folder: PutioFile): boolean {
  return scope.topLevelFolders.some((name) => sameName(name, folder.name)) || scope.pickedFolders.some((f) => f.id === folder.id);
}

/** Saved with the cached library: a cache made with a different scope is read again. */
export function scopeSignature(scope: LibraryScope): string {
  return [...scope.topLevelFolders.map((n) => n.trim().toLowerCase()).sort(), ...scope.pickedFolders.map((f) => `#${f.id}`).sort()].join("|");
}
