/** Runs the merge of the old AMDB folders (lib/folderMergeRun.ts) once per put.io account in this browser, the first
 * time the app opens signed in, and never twice at once in this tab. */
import type { PutioClient } from "../api/putio";
import { mergeMessage, runOldFolderMerge, type OldFolderMergeReport } from "../lib/folderMergeRun";
import { loadSettings, updateSettings, withoutOldFolderPicks } from "../lib/settings";
import { readString, writeString } from "../lib/storage";

const DONE_KEY = "pc.oldFoldersMerged.";
let running: Promise<unknown> | undefined;

/** Returns what to tell the user, if anything. `refreshLibrary` reads the library again after put.io changed. */
export async function mergeOldFoldersOnce(
  putio: Pick<PutioClient, "account"> & Parameters<typeof runOldFolderMerge>[0],
  refreshLibrary: () => Promise<void>,
): Promise<{ report: OldFolderMergeReport; message?: string } | undefined> {
  if (running) return undefined;
  const run = (async () => {
    const account = await putio.account().catch(() => undefined);
    if (!account) return undefined;
    // Per account, so another account signing in here gets its own merge.
    const key = DONE_KEY + (account.user_id ?? account.username.toLowerCase());
    if (readString(key) === "1") return undefined;
    const report = await runOldFolderMerge(putio);
    // Folders picked in Settings that are the old ones go back to the defaults (they're merged, then removed).
    const current = loadSettings();
    const cleaned = withoutOldFolderPicks(current, new Set(report.oldFolderIDs));
    if (cleaned !== current) updateSettings(cleaned);
    // Done for this account once nothing is left to merge; until then it runs again next time.
    if (report.finished) writeString(key, "1");
    if (report.changedPutio) await refreshLibrary();
    return { report, message: mergeMessage(report) };
  })();
  running = run;
  try {
    return await run;
  } finally {
    running = undefined;
  }
}
