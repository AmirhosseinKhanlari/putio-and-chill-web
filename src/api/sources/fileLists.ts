/** Reads what's inside the releases worth checking, to catch a fake whose name looks right: a file list that holds a
 * program, or whose biggest file isn't a video (port of the iPhone app's FileListInspector). Lists come with the
 * release (TorrentGalaxy) or are fetched from its `fileListURL` (apibay), a few at a time with a short timeout, and
 * remembered for the session. A list that can't be read counts as fine: only a list that shows a fake rejects. */
import { filesRejection, type ReleaseRejection, type TorrentFile } from "../../lib/releaseSafety";
import { anySignal, releaseKey, type Release } from "./types";

const PARALLEL = 4;
const TIMEOUT_MS = 5_000;
const cache = new Map<string, TorrentFile[]>();

/** apibay's `f.php` answer: `[{"name": ["a.mkv"], "size": [123]}]`; "no list" comes back as one row whose name is
 * `{"0": "Filelist not found"}`, which reads as unknown. */
export function parseApibayFiles(body: unknown): TorrentFile[] | undefined {
  if (!Array.isArray(body)) return undefined;
  const files = body.flatMap((row): TorrentFile[] => {
    const name = Array.isArray(row?.name) ? row.name[0] : undefined;
    if (typeof name !== "string" || !name) return [];
    const size = Number(Array.isArray(row?.size) ? row.size[0] : NaN);
    return [{ name, sizeBytes: Number.isFinite(size) ? size : undefined }];
  });
  return files.length ? files : undefined;
}

/** The release's files, or undefined when unknown. */
export async function releaseFiles(release: Release, signal?: AbortSignal): Promise<TorrentFile[] | undefined> {
  if (release.files) return release.files;
  const url = release.fileListURL;
  if (!url) return undefined;
  const cached = cache.get(url);
  if (cached) return cached;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: signal ? anySignal([signal, timeout]) : timeout, headers: { Accept: "application/json" } });
    if (!response.ok) return undefined;
    const files = parseApibayFiles(await response.json());
    // A failed read isn't remembered, so the next search tries again.
    if (files) cache.set(url, files);
    return files;
  } catch {
    return undefined;
  }
}

/** Why the release's files look fake, or undefined (also when they can't be read). */
export async function fileRejection(release: Release, signal?: AbortSignal): Promise<ReleaseRejection | undefined> {
  const files = await releaseFiles(release, signal);
  return files ? filesRejection(files) : undefined;
}

/** Checks `releases`, a few at a time; release key → why it's fake, for those that are. */
export async function fileRejections(releases: Release[], signal?: AbortSignal): Promise<Map<string, ReleaseRejection>> {
  const found = new Map<string, ReleaseRejection>();
  const queue = [...releases];
  const worker = async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const rejection = await fileRejection(next, signal);
      if (rejection) found.set(releaseKey(next), rejection);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, releases.length) }, worker));
  return found;
}

/** Which releases to check after a search: every one whose list came with it (free), plus the ones a fetch is worth
 * for: the `limit` most seeded and the two most seeded of each quality. That covers what Smart Get picks and the first
 * screen of Versions under any quality filter. */
export function fileListCandidates(releases: Release[], limit = 10): Release[] {
  const inline = releases.filter((r) => r.files);
  const fetchable = releases.filter((r) => !r.files && r.fileListURL).sort((a, b) => (b.seeders ?? -1) - (a.seeders ?? -1));
  const picked = fetchable.slice(0, limit);
  for (const resolution of new Set(fetchable.map((r) => r.parsed.resolution))) {
    for (const r of fetchable.filter((x) => x.parsed.resolution === resolution).slice(0, 2)) if (!picked.includes(r)) picked.push(r);
  }
  return [...inline, ...picked];
}

/** Forgets every list read (tests). */
export const clearFileListCache = () => cache.clear();
