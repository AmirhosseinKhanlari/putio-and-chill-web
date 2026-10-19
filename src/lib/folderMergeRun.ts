/** Moves what older builds saved in AMDB/Movies and AMDB/TV into Movies and TV Series at the top of put.io (the
 * iPhone app's OldFolderMerge; the rules are in folderMerge.ts). Safe to run any number of times, in several places
 * at once: it lists put.io afresh, never overwrites or deletes a file, treats work done elsewhere as done, and stops
 * at the first rename or move that fails (the rest waits for the next run). */
import { isFolder, PutioError, type PutioClient, type PutioFile } from "../api/putio";
import { defaultFolders, findFolder, sameName } from "./folders";
import { node, planOldFolders, type MergeStep, type PutioNode } from "./folderMerge";

export type MergePutio = Pick<PutioClient, "list" | "createFolder" | "moveFiles" | "rename" | "deleteFiles" | "transfers">;

export interface OldFolderMergeReport {
  /** Movies and shows that left AMDB/Movies and AMDB/TV. */
  movies: number;
  shows: number;
  /** Items renamed "(from AMDB)" because their name was taken. */
  renamed: number;
  /** Other things in AMDB, left where they are. */
  leftInAMDB: string[];
  /** A rename or move failed. What moved stays moved; the rest is tried again next time. */
  couldNotMove: boolean;
  /** Something in put.io changed (the library should be read again). */
  changedPutio: boolean;
  /** Nothing is left to merge (the old folders are gone, or never existed). Until then it runs again each time. */
  finished: boolean;
  /** The old AMDB/Movies and AMDB/TV folders (a Settings pick that's one of them goes back to the default). */
  oldFolderIDs: number[];
}

/** put.io answers at most this many items per folder listing (PutioClient.list). */
const LISTING_LIMIT = 1000;
/** More listings than this means something is wrong: give up quietly. */
const MAX_LISTINGS = 3000;

/** Transfers in these states are done; any other (queued, downloading, completing…) still saves somewhere. */
const SETTLED = new Set(["COMPLETED", "SEEDING", "ERROR"]);
const isGone = (error: unknown) => error instanceof PutioError && error.status === 404;
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** What the user is told, or undefined when there's nothing worth saying. */
export function mergeMessage(report: OldFolderMergeReport): string | undefined {
  const sentences: string[] = [];
  if (report.movies + report.shows > 0) {
    const what = [report.movies && count(report.movies, "movie"), report.shows && count(report.shows, "show")].filter(Boolean).join(" and ");
    const into = [report.movies && defaultFolders.movies, report.shows && defaultFolders.tv].filter(Boolean).join(" and ");
    sentences.push(`Moved ${what} from AMDB into ${into}.`);
    if (report.renamed === 1) sentences.push("One had the same name as something already there, so it now ends in “(from AMDB)”.");
    else if (report.renamed > 1) sentences.push(`${report.renamed} had the same name as something already there, so they now end in “(from AMDB)”.`);
  }
  if (report.couldNotMove) sentences.push("Some things in AMDB couldn't be moved yet. The app will try again next time.");
  return sentences.length ? sentences.join(" ") : undefined;
}

export async function runOldFolderMerge(putio: MergePutio): Promise<OldFolderMergeReport> {
  const report: OldFolderMergeReport = { movies: 0, shows: 0, renamed: 0, leftInAMDB: [], couldNotMove: false, changedPutio: false, finished: false, oldFolderIDs: [] };
  try {
    await merge(putio, report);
  } catch (error) {
    // Offline, signed out, put.io busy: nothing to say; the next time tries again.
    console.warn("Folder merge stopped", error);
  }
  return report;
}

async function merge(putio: MergePutio, report: OldFolderMergeReport) {
  let listings = 0;
  const list = async (id: number) => {
    if (++listings > MAX_LISTINGS) throw new Error("Too many folders to merge");
    return (await putio.list(id)).files;
  };
  const root = await list(0);
  const old = findFolder(root, defaultFolders.oldRoot);
  if (!old) {
    report.finished = true;
    return;
  }
  const oldChildren = await list(old.id);
  const movieSource = findFolder(oldChildren, defaultFolders.oldMovies);
  const tvSource = findFolder(oldChildren, defaultFolders.oldTV);
  report.oldFolderIDs = [movieSource, tvSource].filter((f): f is PutioFile => f !== undefined).map((f) => f.id);

  /** Lists `source` and `target`, and below them every pair of same-named folders (the ones that merge). Undefined
   * when a target folder is too full to list at once (its names can't all be checked). */
  async function loadPair(source: PutioFile, target: PutioFile): Promise<[PutioNode, PutioNode] | undefined> {
    const sourceChildren = await list(source.id);
    const targetChildren = await list(target.id);
    if (targetChildren.length >= LISTING_LIMIT) return undefined;
    const sourceNodes: PutioNode[] = [];
    const targetNodes = targetChildren.map((f) => node(f));
    for (const child of sourceChildren) {
      const index = isFolder(child) ? targetNodes.findIndex((t) => isFolder(t.file) && t.file.id !== child.id && sameName(t.file.name, child.name)) : -1;
      if (index < 0) {
        sourceNodes.push(node(child));
        continue;
      }
      const pair = await loadPair(child, targetNodes[index].file);
      if (!pair) return undefined;
      sourceNodes.push(pair[0]);
      targetNodes[index] = pair[1];
    }
    return [node(source, sourceNodes), node(target, targetNodes)];
  }

  const pairs = new Map<number, [PutioNode, PutioNode]>();
  for (const [source, targetName] of [[movieSource, defaultFolders.movies], [tvSource, defaultFolders.tv]] as const) {
    if (!source) continue;
    const target = await targetFolder(putio, root, targetName);
    const pair = await loadPair(source, target);
    if (pair) pairs.set(source.id, pair);
    else {
      console.warn(`Not merging ${source.name}: ${targetName} is too big to check for name clashes`);
      report.couldNotMove = true;
    }
  }
  const oldNode = node(old, oldChildren.map((c) => pairs.get(c.id)?.[0] ?? node(c)));
  const plan = planOldFolders(oldNode, movieSource && pairs.get(movieSource.id)?.[1], tvSource && pairs.get(tvSource.id)?.[1]);
  report.leftInAMDB = plan.leftAlone.filter((name) => name !== movieSource?.name && name !== tvSource?.name);

  // A folder an unfinished transfer saves into stays, even when empty (the download lands there later).
  const transfers = await putio.transfers().catch(() => []);
  const busy = new Set(transfers.filter((t) => !SETTLED.has((t.status ?? "").toUpperCase())).map((t) => t.save_parent_id).filter((id): id is number => id !== undefined));

  const completed = await execute(putio, plan.steps, busy, report);
  report.movies = await movedCount(putio, plan.movieIDs, movieSource);
  report.shows = await movedCount(putio, plan.showIDs, tvSource);
  if (completed && !report.couldNotMove) report.finished = await oldSourcesGone(putio, old).catch(() => false);
}

/** Runs the steps in order. Returns false when it stopped early. */
async function execute(putio: MergePutio, steps: MergeStep[], busy: Set<number>, report: OldFolderMergeReport): Promise<boolean> {
  const stop = (step: MergeStep, error: unknown) => {
    console.warn("Folder merge step failed", step, error);
    report.couldNotMove = true;
    return false;
  };
  for (const step of steps) {
    if (step.kind === "rename") {
      try {
        await putio.rename(step.id, step.name);
        report.renamed++;
        report.changedPutio = true;
      } catch (error) {
        // Gone from there, or already renamed (done elsewhere first): fine.
        const here = await putio.list(step.parentID).then((l) => l.files, () => undefined);
        if (!here) return stop(step, error);
        const item = here.find((f) => f.id === step.id);
        if (item && item.name !== step.name) return stop(step, error);
      }
    } else if (step.kind === "move") {
      try {
        await putio.moveFiles(step.ids, step.into);
        report.changedPutio = true;
      } catch (error) {
        // Items no longer in `from` were moved already (elsewhere); the rest get one more try.
        const still = await putio.list(step.from).then((l) => new Set(l.files.map((f) => f.id)), () => undefined);
        if (!still) return stop(step, error);
        const left = step.ids.filter((id) => still.has(id));
        if (!left.length) continue;
        try {
          await putio.moveFiles(left, step.into);
          report.changedPutio = true;
        } catch (again) {
          return stop(step, again);
        }
      }
    } else {
      if (busy.has(step.id)) continue;
      // Listed right before deleting: only an empty folder goes (to put.io's Trash, where it can be restored).
      const contents = await putio.list(step.id).then((l) => l.files, () => undefined);
      if (!contents || contents.length) continue;
      try {
        await putio.deleteFiles([step.id]);
        report.changedPutio = true;
      } catch (error) {
        console.warn(`Couldn't delete ${step.name}`, error);
      }
    }
  }
  return true;
}

/** The folder called `name` at the top of put.io, created when missing. When two places create it at the same
 * moment, both settle on the oldest (lowest id), so their merges end up in one place. */
async function targetFolder(putio: MergePutio, root: PutioFile[], name: string): Promise<PutioFile> {
  const existing = findFolder(root, name);
  if (existing) return existing;
  const created = await putio.createFolder(name, 0);
  const now = (await putio.list(0)).files.filter((f) => isFolder(f) && sameName(f.name, name));
  return now.sort((a, b) => a.id - b.id)[0] ?? created;
}

/** How many of `ids` are no longer in `source` (all of them when the folder itself is gone). */
async function movedCount(putio: MergePutio, ids: number[], source: PutioFile | undefined): Promise<number> {
  if (!source || !ids.length) return 0;
  try {
    const still = new Set((await putio.list(source.id)).files.map((f) => f.id));
    return ids.filter((id) => !still.has(id)).length;
  } catch (error) {
    return isGone(error) ? ids.length : 0;
  }
}

/** Whether AMDB no longer holds a Movies or TV folder. */
async function oldSourcesGone(putio: MergePutio, old: PutioFile): Promise<boolean> {
  try {
    const children = (await putio.list(old.id)).files;
    return !findFolder(children, defaultFolders.oldMovies) && !findFolder(children, defaultFolders.oldTV);
  } catch (error) {
    if (isGone(error)) return true;
    throw error;
  }
}
