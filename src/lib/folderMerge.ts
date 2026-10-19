/** Plans merging one put.io folder into another without touching put.io, so every decision can be tested (the
 * iPhone app's FolderMergePlanner). folderMergeRun.ts carries a plan out. */
import { isFolder, isVideo, type PutioFile } from "../api/putio";
import { defaultFolders, findFolder, nameKey } from "./folders";

/** A put.io file or folder with as much of its contents as a merge needs (a folder that moves whole isn't listed). */
export interface PutioNode {
  file: PutioFile;
  children: PutioNode[];
}

export const node = (file: PutioFile, children: PutioNode[] = []): PutioNode => ({ file, children });

/** One change to put.io. Steps run in order, and each is safe to run again. */
export type MergeStep =
  /** Gives an item a new name where it is, before it moves next to something with the same name. */
  | { kind: "rename"; id: number; parentID: number; name: string }
  /** Moves items out of one folder into another (one put.io call). */
  | { kind: "move"; ids: number[]; from: number; into: number }
  /** Deletes a folder the moves emptied (into put.io's Trash). Skipped unless it's empty when the step runs. */
  | { kind: "deleteIfEmpty"; id: number; name: string };

export interface MergePlan {
  steps: MergeStep[];
  /** Items that move under a new name because their name was taken. */
  renamed: number;
}

/** What to do with the old AMDB folder: AMDB/Movies merges into Movies and AMDB/TV into TV Series. */
export interface OldFoldersPlan extends MergePlan {
  /** The movies and shows that move (top-level folders and videos of AMDB/Movies and AMDB/TV): afterwards, the ones
   * no longer there are the ones that moved. */
  movieIDs: number[];
  showIDs: number[];
  /** Names of other things in AMDB, left alone. */
  leftAlone: string[];
}

/** Added to the name of an item that moves next to something with the same name: "Heat (from AMDB).mkv". */
export const renameNote = "from AMDB";

const byName = (a: PutioNode, b: PutioNode) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true });

/** Merges `source` into `target`. Each item moves in, except a folder whose name (ignoring case and surrounding
 * spaces) is already a folder there: that one merges the same way, so AMDB/TV/Severance/Season 2 joins
 * TV Series/Severance/Season 2. An item whose name is taken by anything else moves under a new name; nothing is
 * overwritten or deleted. Folders emptied by the merge are deleted last, deepest first (`source` only when
 * `deleteSource`), and only if they turn out empty when it's their turn. */
export function planMerge(source: PutioNode, target: PutioNode, deleteSource = true): MergePlan {
  const plan: MergePlan = { steps: [], renamed: 0 };
  if (source.file.id === target.file.id) return plan;
  merge(source, target, plan);
  if (deleteSource) plan.steps.push({ kind: "deleteIfEmpty", id: source.file.id, name: source.file.name });
  return plan;
}

function merge(source: PutioNode, target: PutioNode, plan: MergePlan) {
  const targetIDs = new Set(target.children.map((c) => c.file.id));
  const taken = new Set(target.children.map((c) => nameKey(c.file.name)));
  // A new name mustn't match anything still in the source either: that moves in too.
  const sourceNames = source.children.map((c) => nameKey(c.file.name));
  const renames: MergeStep[] = [];
  const moves: number[] = [];
  const nested: [PutioNode, PutioNode][] = [];
  for (const child of [...source.children].sort(byName)) {
    // Listed in both (another device moved it while this one was looking): already done.
    if (targetIDs.has(child.file.id)) continue;
    const key = nameKey(child.file.name);
    const existing = target.children.find((c) => nameKey(c.file.name) === key);
    if (!existing) {
      moves.push(child.file.id);
      taken.add(key);
      continue;
    }
    if (isFolder(child.file) && isFolder(existing.file)) {
      nested.push([child, existing]);
      continue;
    }
    const name = freeName(child, new Set([...taken, ...sourceNames]));
    taken.add(nameKey(name));
    renames.push({ kind: "rename", id: child.file.id, parentID: source.file.id, name });
    moves.push(child.file.id);
    plan.renamed++;
  }
  plan.steps.push(...renames);
  if (moves.length) plan.steps.push({ kind: "move", ids: moves, from: source.file.id, into: target.file.id });
  for (const [from, into] of nested) {
    if (from.file.id === into.file.id) continue;
    merge(from, into, plan);
    plan.steps.push({ kind: "deleteIfEmpty", id: from.file.id, name: from.file.name });
  }
}

/** The whole job: `oldRoot` is AMDB (its Movies and TV folders listed), `movies` and `tv` the folders they merge into
 * (undefined: that one isn't merged this time). AMDB itself goes once nothing else is in it. */
export function planOldFolders(oldRoot: PutioNode, movies?: PutioNode, tv?: PutioNode): OldFoldersPlan {
  const result: OldFoldersPlan = { steps: [], renamed: 0, movieIDs: [], showIDs: [], leftAlone: [] };
  const merged = new Set<number>();
  const pairs: [PutioNode | undefined, PutioNode | undefined, "movieIDs" | "showIDs"][] = [
    [oldSource(oldRoot, defaultFolders.oldMovies), movies, "movieIDs"],
    [oldSource(oldRoot, defaultFolders.oldTV), tv, "showIDs"],
  ];
  for (const [source, target, counted] of pairs) {
    if (!source || !target) continue;
    const plan = planMerge(source, target);
    result.steps.push(...plan.steps);
    result.renamed += plan.renamed;
    result[counted] = source.children.filter((c) => isFolder(c.file) || isVideo(c.file)).map((c) => c.file.id);
    merged.add(source.file.id);
  }
  result.leftAlone = oldRoot.children.filter((c) => !merged.has(c.file.id)).map((c) => c.file.name).sort();
  if (!result.leftAlone.length) result.steps.push({ kind: "deleteIfEmpty", id: oldRoot.file.id, name: oldRoot.file.name });
  return result;
}

/** AMDB's "Movies" or "TV" folder (the exact spelling first, else ignoring case). */
function oldSource(oldRoot: PutioNode, name: string): PutioNode | undefined {
  const file = findFolder(oldRoot.children.map((c) => c.file), name);
  return file && oldRoot.children.find((c) => c.file.id === file.id);
}

/** "Heat.1995.mkv" → "Heat.1995 (from AMDB).mkv", then "(from AMDB 2)" and so on until the name is free. A file's
 * extension is a short tail with a letter ("mkv", "srt"); folders and names like "Show.S02E04" or "Movie.2024" have
 * none. */
export function freeName(item: PutioNode, taken: ReadonlySet<string>): string {
  const match = isFolder(item.file) ? null : /^(.*)\.([A-Za-z0-9]{1,5})$/.exec(item.file.name);
  const [base, ext] = match && /[A-Za-z]/.test(match[2]) ? [match[1].trim(), `.${match[2]}`] : [item.file.name.trim(), ""];
  for (let attempt = 1; attempt < 1000; attempt++) {
    const candidate = `${base} (${attempt === 1 ? renameNote : `${renameNote} ${attempt}`})${ext}`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
  return `${base} (${renameNote} ${item.file.id})${ext}`;
}
