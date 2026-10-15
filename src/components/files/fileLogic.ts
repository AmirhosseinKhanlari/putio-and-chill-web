/** The file manager's rules, kept free of React so they can be tested (ported from the iPhone app's PutioFiles and
 * PutioFileStyle). */
import { isFolder, type PutioFile, type PutioTrashFile } from "../../api/putio";
import { bytes } from "../../lib/format";

/** How a folder is ordered. Name and date keep folders on top, like Finder; size mixes them to find what's big. */
export type FileSort = "name" | "newest" | "largest";

export const fileSorts: { value: FileSort; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "newest", label: "Newest" },
  { value: "largest", label: "Largest" },
];

export function isFileSort(value: unknown): value is FileSort {
  return fileSorts.some((s) => s.value === value);
}

/** "Episode 2" before "Episode 10", case ignored (like Finder's localizedStandardCompare). */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortFiles(files: readonly PutioFile[], sort: FileSort): PutioFile[] {
  return [...files].sort((a, b) => {
    if (sort !== "largest" && isFolder(a) !== isFolder(b)) return isFolder(a) ? -1 : 1;
    switch (sort) {
      case "name": return byName.compare(a.name, b.name);
      case "newest": return (b.created_at ?? "").localeCompare(a.created_at ?? "") || byName.compare(a.name, b.name);
      case "largest": return (b.size ?? 0) - (a.size ?? 0) || byName.compare(a.name, b.name);
    }
  });
}

/** put.io's timestamps ("2026-10-10T10:00:00") are UTC but carry no zone; read them as UTC. */
export function parsePutioDate(text?: string | null): Date | undefined {
  if (!text) return undefined;
  const iso = text.trim().replace(" ", "T");
  const zoned = /([zZ]|[+-]\d\d:?\d\d)$/.test(iso) ? iso : /T/.test(iso) ? `${iso}Z` : `${iso}T00:00:00Z`;
  const date = new Date(zoned);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function shortDate(text?: string | null): string | undefined {
  const date = parsePutioDate(text);
  return date ? dayFormat.format(date) : undefined;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "4 items · 12.3 GB" */
export function summary(files: readonly { size?: number }[]): string {
  const total = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
  return total > 0 ? `${plural(files.length, "item")} · ${bytes(total)}` : plural(files.length, "item");
}

/** Size (or "Empty" for an empty folder) and date. */
export function fileDetail(file: PutioFile): string {
  const size = (file.size ?? 0) > 0 ? bytes(file.size) : isFolder(file) ? "Empty" : undefined;
  return [size, shortDate(file.created_at)].filter(Boolean).join(" · ");
}

/** Whole days until put.io removes it for good (0 on the last day). */
export function daysLeft(expiration: string | undefined, now: Date = new Date()): number | undefined {
  const date = parsePutioDate(expiration);
  return date ? Math.max(0, Math.floor((date.getTime() - now.getTime()) / 86_400_000)) : undefined;
}

/** "1.2 GB · Deleted Oct 12, 2026 · Gone in 27 days" */
export function trashDetail(file: PutioTrashFile, now: Date = new Date()): string {
  const days = daysLeft(file.expiration_date, now);
  const deleted = shortDate(file.deleted_at);
  return [
    file.size !== undefined ? bytes(file.size) : undefined,
    deleted ? `Deleted ${deleted}` : undefined,
    days === undefined ? undefined : days === 0 ? "Gone today" : `Gone in ${plural(days, "day")}`,
  ].filter(Boolean).join(" · ");
}

/** Newest deletions first, as put.io's own Trash shows them. */
export function sortTrash(files: readonly PutioTrashFile[]): PutioTrashFile[] {
  return [...files].sort((a, b) => (b.deleted_at ?? "").localeCompare(a.deleted_at ?? ""));
}

export type Transfer = "move" | "copy";

/** Whether the picker can drop `ids` into `folderID`: never into one of the items themselves, and a move into the
 * folder they're already in would do nothing. */
export function canDropInto(action: Transfer, folderID: number, ids: readonly number[], sources: readonly number[]): boolean {
  if (ids.includes(folderID)) return false;
  return action === "copy" || !sources.every((s) => s === folderID);
}

/** The part of a name to select when renaming: the name without its extension, like Finder. Folders keep it all. */
export function renameSelection(name: string, folder: boolean): [number, number] {
  const dot = name.lastIndexOf(".");
  return !folder && dot > 0 && name.length - dot <= 6 ? [0, dot] : [0, name.length];
}

/** A name put.io would accept, or undefined when there's nothing to change. */
export function cleanName(input: string, current = ""): string | undefined {
  const name = input.trim();
  return name && name !== current ? name : undefined;
}

export const itemsLabel = (count: number) => plural(count, "item");

/** Library entries to drop after a delete: the deleted videos, and videos sitting right inside a deleted folder.
 * Deeper ones go with the library refresh that follows. */
export function idsToForget(deleted: readonly number[], entries: readonly { id: number; parentID?: number }[]): number[] {
  const gone = new Set(deleted);
  return [...deleted, ...entries.filter((e) => e.parentID !== undefined && gone.has(e.parentID) && !gone.has(e.id)).map((e) => e.id)];
}
