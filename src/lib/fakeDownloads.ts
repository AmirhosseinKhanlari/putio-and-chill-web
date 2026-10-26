/** What a finished put.io download turned out to hold (port of the iPhone app's DownloadCheck). Fakes carry a
 * program, or files with no video at all; those are never played, are deleted (put.io keeps deleted files in its
 * trash), and their release is never offered again. A disc image isn't a fake. */
import { isFolder, isVideo, type PutioClient, type PutioFile, type PutioTransfer } from "../api/putio";
import { badReleaseKeys, rememberBadRelease } from "./badReleases";
import { isDiscImage, isProgramFile } from "./releaseSafety";
import type { PendingTransfer } from "./smartGet";

export const fakeMessage = "This download didn't contain a video — it looks fake. Removed it.";
/** put.io can list a finished folder before every file is in it: "no video" only counts after this long. */
export const FILE_GRACE_MS = 180_000;

export type DownloadCheck =
  | { kind: "video" }
  | { kind: "program"; name: string }
  | { kind: "noVideo" }
  /** Nothing listed yet. */
  | { kind: "unknown" };

export function downloadVerdict(files: PutioFile[]): DownloadCheck {
  if (!files.length) return { kind: "unknown" };
  const program = files.find((f) => isProgramFile(f.name));
  if (program) return { kind: "program", name: program.name };
  if (files.some((f) => isVideo(f) || isDiscImage(f.name))) return { kind: "video" };
  return { kind: "noVideo" };
}

/** Looks through a finished download, three folder levels down. */
export async function inspectDownload(putio: Pick<PutioClient, "file" | "list">, fileID: number): Promise<DownloadCheck> {
  try {
    const root = await putio.file(fileID);
    if (!isFolder(root)) return downloadVerdict([root]);
    const files: PutioFile[] = [];
    let level = [root.id];
    for (let depth = 0; depth < 3 && level.length; depth++) {
      const next: number[] = [];
      for (const id of level) {
        for (const f of (await putio.list(id)).files) (isFolder(f) ? next.push(f.id) : files.push(f));
      }
      level = next;
    }
    return downloadVerdict(files);
  } catch {
    return { kind: "unknown" };
  }
}

/** Whether a finished transfer was found fake (by its hash or the link sent). */
export function isFakeTransfer(t: PutioTransfer, p: PendingTransfer | undefined, bad: Set<string>): boolean {
  return badReleaseKeys(t.hash, p?.link).some((k) => bad.has(k));
}

/** Checks a finished transfer the app sent: "fake" (deleted and remembered), "ok", or "wait" (look again on the next
 * poll). `doneSince` is when it was first seen finished. */
export async function reviewFinishedDownload(
  putio: Pick<PutioClient, "file" | "list" | "deleteFiles">, t: PutioTransfer, p: PendingTransfer | undefined, doneSince: number, now = Date.now(),
): Promise<"fake" | "ok" | "wait"> {
  if (!t.file_id) return "ok";
  const check = await inspectDownload(putio, t.file_id);
  const waited = now - doneSince >= FILE_GRACE_MS;
  if (check.kind === "video") return "ok";
  if (check.kind === "unknown") return waited ? "ok" : "wait";
  if (check.kind === "noVideo" && !waited) return "wait";
  await putio.deleteFiles([t.file_id]).catch(() => {});
  rememberBadRelease(badReleaseKeys(t.hash, p?.link));
  if (import.meta.env.DEV) console.debug(`[release-safety] removed fake download ${t.name ?? t.id}: ${check.kind === "program" ? `contains a program (${check.name})` : "no video inside"}`);
  return "fake";
}
