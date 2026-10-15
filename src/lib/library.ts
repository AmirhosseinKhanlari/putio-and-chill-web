/** Every video in put.io, matched to its movie or show (port of the iPhone app's LibraryIndex): shown at once from
 * the last load, then refreshed. Each name is looked up on TMDB once. */
import { isFolder, isVideo, type PutioClient, type PutioFile } from "../api/putio";
import type { MediaKind } from "../api/tmdb";
import { normalizeTitle, pickMatch } from "./matcher";
import { parseReleaseName } from "./releaseName";
import { keys, readJSON, writeJSON } from "./storage";

export interface LibraryMatch {
  tmdbID: number;
  kind: MediaKind;
  season?: number;
  episode?: number;
  title: string;
  year?: number;
  posterPath?: string | null;
  backdropPath?: string | null;
}

export interface LibraryEntry {
  id: number;
  name: string;
  size?: number;
  createdAt?: string;
  updatedAt?: string;
  startFrom: number;
  parentID?: number;
  folderName?: string;
  match?: LibraryMatch;
}

interface Snapshot {
  entries: LibraryEntry[];
  updatedAt: number;
}

type CachedMatch = Omit<LibraryMatch, "season" | "episode"> | null;
type Searcher = (kind: MediaKind, title: string, year?: number) => Promise<{ tmdbID: number; title: string; year?: number; posterPath?: string | null; backdropPath?: string | null }[]>;

const SKIPPED_FOLDERS = new Set(["subs", "subtitles", "sub", "sample", "samples", "screens", "screenshots", "proof", "artwork", "covers"]);
const MAX_FOLDERS = 2000;

/** "Season 2" / "S02" folders: the season, and the show from the folder above it. */
function seasonOfFolder(name: string): number | undefined {
  const m = /^(?:season|s)[ ._-]?(\d{1,2})$/i.exec(name.trim());
  return m ? Number(m[1]) : undefined;
}

/** What a video's name (and its folders) say it is. Season-pack episodes are often named only "E04 - Title" or
 * "04. Title" inside "Show.S02.1080p" or "Show/Season 2". */
export function describeVideo(fileName: string, folderName?: string, grandparentName?: string) {
  const parsed = parseReleaseName(fileName);
  if (parsed.season !== undefined && parsed.title) return parsed;
  const folder = folderName ? parseReleaseName(folderName) : undefined;
  const folderSeason = folderName ? seasonOfFolder(folderName) : undefined;
  const episode = /\bE(\d{1,3})\b/i.exec(fileName)?.[1] ?? /^(\d{1,3})[ .\-_]/.exec(fileName)?.[1];
  if (folder && folder.season !== undefined && folder.title && episode) {
    return { ...parsed, title: folder.title, season: folder.season, episode: Number(episode) };
  }
  if (folderSeason !== undefined && grandparentName && episode) {
    return { ...parsed, title: parseReleaseName(grandparentName).title, season: folderSeason, episode: Number(episode) };
  }
  return parsed;
}

export class LibraryIndex {
  private snapshot: Snapshot = readJSON<Snapshot>(keys.library, { entries: [], updatedAt: 0 });
  private matches = readJSON<Record<string, CachedMatch>>(keys.matches, {});
  private durations = readJSON<Record<string, number>>(keys.durations, {});
  private progress: Record<number, number> = {};
  private lookups = new Map<string, Promise<CachedMatch | undefined>>();
  private listeners = new Set<() => void>();
  private refreshing?: Promise<void>;
  isRefreshing = false;
  progressText = "";

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private version = 0;
  getVersion = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  get entries(): LibraryEntry[] { return this.snapshot.entries; }
  get updatedAt(): number { return this.snapshot.updatedAt; }
  isStale(maxAgeMs = 15 * 60_000) { return Date.now() - this.snapshot.updatedAt > maxAgeMs; }

  // MARK: Reading

  resumeSeconds(entry: LibraryEntry): number { return this.progress[entry.id] ?? entry.startFrom ?? 0; }

  matching(tmdbID: number, season?: number, episode?: number): LibraryEntry[] {
    return this.entries.filter((e) => e.match?.tmdbID === tmdbID
      && (season === undefined || e.match.season === season)
      && (episode === undefined || e.match.episode === episode));
  }

  /** Started videos, latest first, one per show (its latest started episode). */
  continueWatching(): LibraryEntry[] {
    const started = this.entries.filter((e) => this.resumeSeconds(e) >= 30)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    const seen = new Set<string>();
    return started.filter((e) => {
      const key = e.match?.kind === "tv" ? `tv-${e.match.tmdbID}` : `f-${e.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Newest first; a show appears once. */
  recentlyAdded(limit = 30): LibraryEntry[] {
    const seen = new Set<string>();
    return [...this.entries].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .filter((e) => {
        const key = e.match ? `${e.match.kind}-${e.match.tmdbID}` : `f-${e.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  /** How much is watched (0…1): the length the player saw, else `estimatedSeconds` (TMDB's runtime). */
  watchedFraction(entry: LibraryEntry, estimatedSeconds?: number): number | undefined {
    const position = this.resumeSeconds(entry);
    const length = this.durations[entry.id] ?? estimatedSeconds;
    if (position < 30 || !length) return undefined;
    return Math.min(1, position / length);
  }

  remainingSeconds(entry: LibraryEntry, estimatedSeconds?: number): number | undefined {
    const position = this.resumeSeconds(entry);
    const length = this.durations[entry.id] ?? estimatedSeconds;
    if (position < 30 || !length || length <= position) return undefined;
    return length - position;
  }

  // MARK: Writing (from the player)

  noteProgress(fileID: number, seconds: number, duration?: number) {
    this.progress[fileID] = Math.floor(seconds);
    if (duration && Number.isFinite(duration) && duration > 0 && this.durations[fileID] !== Math.floor(duration)) {
      this.durations[fileID] = Math.floor(duration);
      writeJSON(keys.durations, this.durations);
    }
    const entry = this.entries.find((e) => e.id === fileID);
    if (entry) entry.updatedAt = new Date().toISOString();
    this.emit();
  }

  forget(ids: number[]) {
    const gone = new Set(ids);
    this.snapshot = { ...this.snapshot, entries: this.entries.filter((e) => !gone.has(e.id)) };
    writeJSON(keys.library, this.snapshot);
    this.emit();
  }

  clear() {
    this.snapshot = { entries: [], updatedAt: 0 };
    this.progress = {};
    writeJSON(keys.library, this.snapshot);
    this.emit();
  }

  // MARK: Refreshing

  refresh(putio: PutioClient, search: Searcher): Promise<void> {
    this.refreshing ??= this.run(putio, search).finally(() => {
      this.refreshing = undefined;
      this.isRefreshing = false;
      this.progressText = "";
      this.emit();
    });
    return this.refreshing;
  }

  private async run(putio: PutioClient, search: Searcher) {
    this.isRefreshing = true;
    this.lookups.clear();
    this.progressText = "Reading your put.io…";
    this.emit();
    let videos: Awaited<ReturnType<LibraryIndex["walk"]>>;
    try {
      videos = await this.walk(putio);
    } catch {
      return; // put.io couldn't be read: keep the library from last time.
    }
    this.progressText = `Matching ${videos.length} videos…`;
    this.emit();
    const entries: LibraryEntry[] = new Array(videos.length);
    let next = 0;
    const worker = async () => {
      while (next < videos.length) {
        const index = next++;
        const { file, folder, grandparent } = videos[index];
        entries[index] = {
          id: file.id, name: file.name, size: file.size, createdAt: file.created_at, updatedAt: file.updated_at,
          startFrom: file.start_from ?? 0, parentID: file.parent_id, folderName: folder,
          match: await this.match(file.name, folder, grandparent, search),
        };
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    // Positions saved in this session stay until put.io has them too.
    for (const e of entries) if (this.progress[e.id] !== undefined && e.startFrom === this.progress[e.id]) delete this.progress[e.id];
    this.snapshot = { entries, updatedAt: Date.now() };
    writeJSON(keys.library, this.snapshot);
    writeJSON(keys.matches, this.matches);
  }

  private async walk(putio: PutioClient) {
    const found: { file: PutioFile; folder?: string; grandparent?: string }[] = [];
    let queue: { id: number; name?: string; parentName?: string }[] = [{ id: 0 }];
    let read = 0;
    while (queue.length && read < MAX_FOLDERS) {
      const batch = queue.splice(0, 6);
      read += batch.length;
      // The top folder must be readable (else the sign-in is bad); a folder deeper down may fail alone.
      const lists = await Promise.all(batch.map((f) => (f.id === 0 ? putio.list(0) : putio.list(f.id).catch(() => ({ files: [] as PutioFile[] })))));
      lists.forEach((list, i) => {
        for (const file of list.files) {
          if (isFolder(file)) {
            if (!SKIPPED_FOLDERS.has(file.name.trim().toLowerCase())) queue.push({ id: file.id, name: file.name, parentName: batch[i].name });
          } else if (isVideo(file) && !/\bsample\b/i.test(file.name)) {
            found.push({ file, folder: batch[i].name, grandparent: batch[i].parentName });
          }
        }
      });
      this.progressText = `Reading your put.io… ${found.length} videos`;
      this.emit();
      if (queue.length > MAX_FOLDERS) queue = queue.slice(0, MAX_FOLDERS);
    }
    return found;
  }

  private async match(fileName: string, folder: string | undefined, grandparent: string | undefined, search: Searcher): Promise<LibraryMatch | undefined> {
    const parsed = describeVideo(fileName, folder, grandparent);
    if (!parsed.title) return undefined;
    const kind: MediaKind = parsed.season !== undefined ? "tv" : "movie";
    const year = kind === "movie" ? parsed.year : undefined;
    const key = `${kind}|${normalizeTitle(parsed.title)}|${year ?? ""}`;
    let cached = this.matches[key];
    if (cached === undefined) {
      // Episodes of one show are matched side by side: they share one lookup.
      let lookup = this.lookups.get(key);
      if (!lookup) {
        lookup = search(kind, parsed.title, year).then((results) => {
          const best = pickMatch(results, parsed.title, year);
          const found: CachedMatch = best
            ? { tmdbID: best.item.tmdbID, kind, title: best.item.title, year: best.item.year, posterPath: best.item.posterPath, backdropPath: best.item.backdropPath }
            : null;
          this.matches[key] = found;
          return found;
        }, () => undefined); // Try again next refresh.
        this.lookups.set(key, lookup);
      }
      const looked = await lookup;
      if (looked === undefined) return undefined;
      cached = looked;
    }
    return cached ? { ...cached, season: parsed.season, episode: parsed.episode } : undefined;
  }
}

export const library = new LibraryIndex();
