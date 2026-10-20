/** Fix Match choices (port of the iPhone app's MatchOverrides): the title the user picked for files that automatic
 * matching got wrong or couldn't find. Kept on this device and applied on every library update before automatic
 * matching, until Match Automatically. */
import type { MediaKind } from "../api/tmdb";
import { normalizeTitle } from "./matcher";
import { parseReleaseName } from "./releaseName";

export interface MatchOverride {
  tmdbID: number;
  mediaType: MediaKind;
  title: string;
  year?: number;
  posterPath?: string | null;
  backdropPath?: string | null;
  /** Shows: the season these files are, whatever their names say ("Monster.2022.S03E01" is season 1 of "Monster:
   * The Ed Gein Story"). Undefined keeps the season in each name. */
  season?: number;
}

export interface MatchOverrides {
  /** put.io file id → title. */
  files: Record<string, MatchOverride>;
  /** put.io folder id → title, for every video anywhere below that folder. */
  folders: Record<string, MatchOverride>;
  /** `nameKey` → title, for every video named like it (same title, year and season), including ones added later. */
  names: Record<string, MatchOverride>;
}

export const noOverrides = (): MatchOverrides => ({ files: {}, folders: {}, names: {} });

export const isEmpty = (o: MatchOverrides) => !Object.keys(o.files).length && !Object.keys(o.folders).length && !Object.keys(o.names).length;

/** "Monster.2022.S03E05.1080p.mkv" → "monster|2022|s3": the title (with its year, which tells same-named shows apart)
 * and season, so every episode of that season, and no other, shares it. Undefined when there's no title. */
export function nameKey(fileName: string): string | undefined {
  const parsed = parseReleaseName(fileName);
  const title = normalizeTitle(parsed.title);
  if (!title) return undefined;
  return `${title}|${parsed.year ?? ""}|${parsed.season !== undefined ? `s${parsed.season}` : "movie"}`;
}

/** The folders a file in `parentID` sits in, nearest first, as far up as `parents` (folder id → its parent) knows. */
export function folderChain(parentID: number | undefined, parents: Record<string, number>): number[] {
  const chain: number[] = [];
  let current = parentID;
  while (current !== undefined && current !== 0 && !chain.includes(current)) {
    chain.push(current);
    current = parents[current];
  }
  return chain;
}

/** The override for a file: its own first, then the nearest folder above it, then its name. */
export function overrideFor(overrides: MatchOverrides, file: { id: number; name: string }, chain: number[]): MatchOverride | undefined {
  const own = overrides.files[file.id];
  if (own) return own;
  for (const id of chain) {
    const folder = overrides.folders[id];
    if (folder) return folder;
  }
  const key = nameKey(file.name);
  return key ? overrides.names[key] : undefined;
}

/** What a Fix Match applies to. */
export type FixMatchTarget =
  | { kind: "files"; ids: number[] }
  | { kind: "folder"; id: number; name: string }
  | { kind: "name"; fileName: string };

/** Adds the choice for `target`. */
export function withOverride(overrides: MatchOverrides, target: FixMatchTarget, chosen: MatchOverride): MatchOverrides {
  const next: MatchOverrides = { files: { ...overrides.files }, folders: { ...overrides.folders }, names: { ...overrides.names } };
  if (target.kind === "files") for (const id of target.ids) next.files[id] = chosen;
  if (target.kind === "folder") next.folders[target.id] = chosen;
  if (target.kind === "name") {
    const key = nameKey(target.fileName);
    if (key) next.names[key] = chosen;
  }
  return next;
}

/** Match Automatically: drops every choice covering these files (their own, any folder above them, their name) and
 * the folder's own when it was opened on a folder. */
export function withoutOverrides(overrides: MatchOverrides, files: { id: number; name: string; chain: number[] }[], folderID?: number): MatchOverrides {
  const next: MatchOverrides = { files: { ...overrides.files }, folders: { ...overrides.folders }, names: { ...overrides.names } };
  for (const file of files) {
    delete next.files[file.id];
    for (const id of file.chain) delete next.folders[id];
    const key = nameKey(file.name);
    if (key) delete next.names[key];
  }
  if (folderID !== undefined) delete next.folders[folderID];
  return next;
}

/** For the "applies to" choices. */
export function targetLabel(target: FixMatchTarget): string {
  switch (target.kind) {
    case "files": return target.ids.length === 1 ? "This file only" : `These ${target.ids.length} files`;
    case "folder": return `Everything in “${target.name}”`;
    case "name": {
      const parsed = parseReleaseName(target.fileName);
      const title = [parsed.title, parsed.year].filter(Boolean).join(" ");
      return `All files named “${title}”${parsed.season !== undefined ? ` season ${parsed.season}` : ""}`;
    }
  }
}

/** What Fix Match was opened on and what it can apply to (broadest last). */
export interface FixMatchRequest {
  /** The videos it's about (empty for a folder). */
  files: { id: number; name: string; parentID?: number }[];
  /** The folder it's about, when opened on one. */
  folderID?: number;
  /** A name to suggest the search from and to read the named season from. */
  sampleName: string;
  targets: FixMatchTarget[];
}

/** One video: just it, everything in its folder, or every file named like it. */
export function videoRequest(file: { id: number; name: string; parentID?: number }, folderName?: string): FixMatchRequest {
  const targets: FixMatchTarget[] = [{ kind: "files", ids: [file.id] }];
  if (file.parentID) targets.push({ kind: "folder", id: file.parentID, name: folderName || "its folder" });
  if (nameKey(file.name)) targets.push({ kind: "name", fileName: file.name });
  return { files: [file], sampleName: file.name, targets };
}

/** Every file of a Library card (a show's episodes). */
export function entriesRequest(entries: { id: number; name: string; parentID?: number; folderName?: string }[]): FixMatchRequest {
  if (entries.length === 1) return videoRequest(entries[0], entries[0].folderName);
  return { files: entries, sampleName: entries[0]?.name ?? "", targets: [{ kind: "files", ids: entries.map((e) => e.id) }] };
}

/** Every video below a folder. */
export function folderRequest(folder: { id: number; name: string }): FixMatchRequest {
  return { files: [], folderID: folder.id, sampleName: folder.name, targets: [{ kind: "folder", id: folder.id, name: folder.name }] };
}

/** "Monster.2022.S03E01.1080p.mkv" → "Monster"; a folder name like "Monster (2022)" → "Monster". */
export function suggestedQuery(name: string): string {
  return parseReleaseName(name).title || name.replace(/\.[a-z0-9]{2,4}$/i, "");
}
