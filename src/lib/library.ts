/** The videos in put.io that the library covers (libraryScope.ts: Movies, TV Series, picked folders, loose videos
 * at the top), matched to their movie or show (port of the iPhone app's LibraryIndex): shown at once from the last
 * load, then refreshed. Each name is looked up on TMDB once. */
import { isFolder, isVideo, type PutioClient, type PutioFile } from "../api/putio";
import type { MediaKind } from "../api/tmdb";
import { includesTopLevelFolder, scopeSignature, standardScope, type LibraryScope } from "./libraryScope";
import { folderChain, noOverrides, overrideFor, withOverride, withoutOverrides, type FixMatchTarget, type MatchOverride, type MatchOverrides } from "./matchOverrides";
import { normalizeTitle, pickMatch, pickShow } from "./matcher";
import { deviceSave, mergePosition, putioRead, samePosition, type Position } from "./positions";
import { parseReleaseName } from "./releaseName";
import { keys, readJSON, writeJSON } from "./storage";
import { markAfter, STARTED_SECONDS } from "./watched";

export interface LibraryMatch {
  tmdbID: number;
  kind: MediaKind;
  season?: number;
  episode?: number;
  title: string;
  year?: number;
  posterPath?: string | null;
  backdropPath?: string | null;
  /** 1 for an exact match or a Fix Match choice; lower for a likely one. */
  confidence?: number;
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
  /** The folder above `folderName` ("Show" for "Show/Season 2/E01.mkv"). */
  grandparentName?: string;
  match?: LibraryMatch;
}

interface Snapshot {
  entries: LibraryEntry[];
  updatedAt: number;
  /** scopeSignature of the walk that found these (absent in older caches, which read all of put.io). */
  scope?: string;
  /** Older builds' positions saved here, by file id (now in keys.positions). */
  progress?: Record<string, number>;
  /** Folder id → the folder it's in, for the folders the walk read (Fix Match by folder). */
  folders?: Record<string, number>;
}

/** A Continue Watching card before Up Next is worked out: a video to resume, or a show whose latest episode was
 * finished (its next one comes up). `at`: when it was last watched (-1 when unknown). */
export type ContinueItem =
  | { kind: "resume"; entry: LibraryEntry; at: number }
  | { kind: "upNext"; finished: LibraryEntry; at: number };

type CachedMatch = Omit<LibraryMatch, "season" | "episode"> | null;
type SearchResult = { tmdbID: number; title: string; year?: number; posterPath?: string | null; backdropPath?: string | null };
type Searcher = (kind: MediaKind, title: string, year?: number) => Promise<SearchResult[]>;
/** A show's number of seasons (TMDB's number_of_seasons); undefined when unknown. */
export type SeasonCounter = (tmdbID: number) => Promise<number | undefined>;

const SKIPPED_FOLDERS = new Set(["subs", "subtitles", "sub", "sample", "samples", "screens", "screenshots", "proof", "artwork", "covers"]);
const MAX_FOLDERS = 2000;
/** A position for a file no longer in the library is kept this long (unless put.io doesn't have it yet). */
const KEEP_GONE_POSITIONS_MS = 60 * 24 * 60 * 60_000;

/** "Season 2" / "S02" folders: the season, and the show from the folder above it. */
function seasonOfFolder(name: string): number | undefined {
  const m = /^(?:season|s)[ ._-]?(\d{1,2})$/i.exec(name.trim());
  return m ? Number(m[1]) : undefined;
}

/** A season-pack episode's number from a short name: "E04 - Title" or "04. Title". */
function episodeInName(fileName: string): number | undefined {
  const found = /\bE(\d{1,3})\b/i.exec(fileName)?.[1] ?? /^(\d{1,3})[ .\-_]/.exec(fileName)?.[1];
  return found ? Number(found) : undefined;
}

/** What a video's name (and its folders) say it is. Season-pack episodes are often named only "E04 - Title" or
 * "04. Title" inside "Show.S02.1080p" or "Show/Season 2". */
export function describeVideo(fileName: string, folderName?: string, grandparentName?: string) {
  const parsed = parseReleaseName(fileName);
  if (parsed.season !== undefined && parsed.title) return parsed;
  const folder = folderName ? parseReleaseName(folderName) : undefined;
  const folderSeason = folderName ? seasonOfFolder(folderName) : undefined;
  const episode = episodeInName(fileName);
  if (folder && folder.season !== undefined && folder.title && episode) {
    return { ...parsed, title: folder.title, season: folder.season, episode };
  }
  if (folderSeason !== undefined && grandparentName && episode) {
    return { ...parsed, title: parseReleaseName(grandparentName).title, season: folderSeason, episode };
  }
  return parsed;
}

/** A Fix Match choice as one file's match. Episodes come from the name (as in season packs); a show file without a
 * season anywhere is season 1. */
export function applyOverride(chosen: MatchOverride, fileName: string, folderName?: string, grandparentName?: string): LibraryMatch {
  const base = { tmdbID: chosen.tmdbID, title: chosen.title, year: chosen.year, posterPath: chosen.posterPath, backdropPath: chosen.backdropPath, confidence: 1 };
  if (chosen.mediaType === "movie") return { ...base, kind: "movie" };
  const named = describeVideo(fileName, folderName, grandparentName);
  return { ...base, kind: "tv", season: chosen.season ?? named.season ?? 1, episode: named.episode ?? episodeInName(fileName) };
}

/** The automatic-match cache key: movies by title and year; shows by title, the year in the name and the season,
 * which together decide the pick (pickShow). */
function matchKey(parsed: { title: string; year?: number; season?: number }): string {
  const title = normalizeTitle(parsed.title);
  return parsed.season === undefined ? `movie|${title}|${parsed.year ?? ""}` : `tv|${title}|${parsed.year ?? ""}|s${parsed.season}`;
}

export class LibraryIndex {
  private snapshot: Snapshot = readJSON<Snapshot>(keys.library, { entries: [], updatedAt: 0 });
  private matches = readJSON<Record<string, CachedMatch>>(keys.matches, {});
  private overrides = readJSON<MatchOverrides>(keys.matchOverrides, noOverrides());
  private durations = readJSON<Record<string, number>>(keys.durations, {});
  private positions = this.loadPositions();
  /** File id → when it was watched (lib/watched.ts); this account's, like the positions. */
  private watched = readJSON<Record<number, number>>(keys.watched, {});
  private lookups = new Map<string, Promise<CachedMatch | undefined>>();
  /** TMDB searches of this update: every episode of a show asks the same one. */
  private searches = new Map<string, Promise<SearchResult[]>>();
  /** Show id → number of seasons, once per show (a failed lookup is retried next time). */
  private seasonCounts = new Map<number, Promise<number | undefined>>();
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
  /** The entries were read with a different scope (an older build, or a folder picked since): read put.io again. */
  needsRescan(scope: LibraryScope) { return this.snapshot.updatedAt > 0 && this.snapshot.scope !== scopeSignature(scope); }

  // MARK: Reading

  resumeSeconds(entry: LibraryEntry): number { return this.positions[entry.id]?.seconds ?? entry.startFrom ?? 0; }

  position(fileID: number): Position | undefined { return this.positions[fileID]; }

  matching(tmdbID: number, season?: number, episode?: number): LibraryEntry[] {
    return this.entries.filter((e) => e.match?.tmdbID === tmdbID
      && (season === undefined || e.match.season === season)
      && (episode === undefined || e.match.episode === episode));
  }

  isWatched(fileID: number): boolean { return this.watched[fileID] !== undefined; }

  /** When it was watched (ms), if it is. */
  watchedAt(fileID: number): number | undefined { return this.watched[fileID]; }

  /** Started and watched videos, last watched (anywhere) first; when that's unknown, by put.io's last change. */
  private activity(): ContinueItem[] {
    const items = this.entries.flatMap((e): ContinueItem[] => {
      const mark = this.watched[e.id];
      if (mark !== undefined) return [{ kind: "upNext", finished: e, at: mark }];
      return this.resumeSeconds(e) >= STARTED_SECONDS ? [{ kind: "resume", entry: e, at: this.positions[e.id]?.watchedAt ?? -1 }] : [];
    });
    const file = (i: ContinueItem) => (i.kind === "resume" ? i.entry : i.finished);
    return items.sort((a, b) => b.at - a.at || (file(b).updatedAt ?? "").localeCompare(file(a).updatedAt ?? ""));
  }

  /** Continue Watching, latest first, one card per movie or show. A show's card is its latest activity: an episode
   * to resume, or the one after an episode just finished (worked out with TMDB: upNext.ts). A finished movie, file
   * or special leaves. */
  continueWatchingItems(): ContinueItem[] {
    const seen = new Set<string>();
    return this.activity().filter((item) => {
      const e = item.kind === "resume" ? item.entry : item.finished;
      const m = e.match;
      if (item.kind === "upNext" && !(m?.kind === "tv" && m.season !== undefined && m.season > 0 && m.episode !== undefined)) return false;
      const key = m?.kind === "tv" ? `tv-${m.tmdbID}` : `f-${e.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** The videos to resume in Continue Watching (shows whose latest episode was finished are left out). */
  continueWatching(): LibraryEntry[] {
    return this.continueWatchingItems().flatMap((i) => (i.kind === "resume" ? [i.entry] : []));
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

  /** How much is watched (0…1): the length the player saw, else `estimatedSeconds` (TMDB's runtime). A watched
   * video is all of it. */
  watchedFraction(entry: LibraryEntry, estimatedSeconds?: number): number | undefined {
    const position = this.resumeSeconds(entry);
    if (this.isWatched(entry.id) && position < STARTED_SECONDS) return 1;
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

  /** Whose positions to read from put.io when the app comes to the front: the started and watched ones (last
   * watched first: a rewatch elsewhere brings one back), then the latest changed videos, where another device may
   * have started something new. Those first leave room for at least 10 of these, as in the native apps. */
  positionCandidates(limit = 30): number[] {
    const active = this.activity().slice(0, Math.max(0, limit - 10)).map((i) => (i.kind === "resume" ? i.entry : i.finished));
    const changed = [...this.entries].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return [...new Set([...active, ...changed].map((e) => e.id))].slice(0, limit);
  }

  /** Files saved here that put.io doesn't have yet. */
  pendingPositions(): number[] {
    return Object.entries(this.positions).filter(([, p]) => p.pending).map(([id]) => Number(id));
  }

  // MARK: Writing

  /** The player's position: newest, so it wins, and pending until put.io has it. A started one takes away a
   * watched mark (a rewatch). */
  noteProgress(fileID: number, seconds: number, duration?: number): Position {
    this.noteDuration(fileID, duration);
    return this.takePosition(fileID, deviceSave(Math.floor(seconds), Date.now()));
  }

  /** Watched to the end (or the next episode was played): marked watched now, and put.io's position reset. */
  noteWatched(fileID: number, duration?: number): Position {
    this.noteDuration(fileID, duration);
    const at = Date.now();
    const position = this.takePosition(fileID, deviceSave(0, at));
    this.setMark(fileID, at);
    return position;
  }

  private noteDuration(fileID: number, duration?: number) {
    if (duration && Number.isFinite(duration) && duration > 0 && this.durations[fileID] !== Math.floor(duration)) {
      this.durations[fileID] = Math.floor(duration);
      writeJSON(keys.durations, this.durations);
    }
  }

  /** put.io's position from a read that started at `readAt`. A changed value means it was watched since; 0 is kept
   * too (finished elsewhere: watched, out of Continue Watching). */
  notePutioPosition(fileID: number, seconds: number, readAt: number): Position {
    return this.takePosition(fileID, putioRead(Math.floor(seconds), readAt, seconds > 0 ? readAt : undefined));
  }

  /** put.io took the save stamped `at` (a newer one made meanwhile stays pending). */
  markSent(fileID: number, at: number) {
    const current = this.positions[fileID];
    if (current?.pending && current.at === at) this.setPosition(fileID, { ...current, pending: false });
  }

  private takePosition(fileID: number, incoming: Position): Position {
    const previous = this.positions[fileID];
    const next = mergePosition(previous, incoming);
    if (!samePosition(previous, next)) this.setPosition(fileID, next);
    this.setMark(fileID, markAfter(this.watched[fileID], previous, next, incoming));
    return next;
  }

  private setMark(fileID: number, mark: number | undefined) {
    if (this.watched[fileID] === mark) return;
    const marks = { ...this.watched };
    if (mark === undefined) delete marks[fileID]; else marks[fileID] = mark;
    this.watched = marks;
    writeJSON(keys.watched, this.watched);
    this.emit();
  }

  private setPosition(fileID: number, position: Position) {
    this.positions = { ...this.positions, [fileID]: position };
    writeJSON(keys.positions, this.positions);
    this.emit();
  }

  /** Saved positions, or (once) the ones an older build kept in the library cache. */
  private loadPositions(): Record<number, Position> {
    const saved = readJSON<Record<number, Position> | null>(keys.positions, null);
    if (saved) return saved;
    const old = Object.entries(this.snapshot.progress ?? {});
    return Object.fromEntries(old.map(([id, seconds]) => [id, { seconds, at: this.snapshot.updatedAt, source: "device", pending: false } satisfies Position]));
  }

  forget(ids: number[]) {
    const gone = new Set(ids);
    this.snapshot = { ...this.snapshot, entries: this.entries.filter((e) => !gone.has(e.id)) };
    writeJSON(keys.library, this.snapshot);
    this.emit();
  }

  clear() {
    this.snapshot = { entries: [], updatedAt: 0 };
    this.positions = {};
    this.watched = {};
    // Fix Match choices name this account's files and folders.
    this.overrides = noOverrides();
    writeJSON(keys.library, this.snapshot);
    writeJSON(keys.positions, this.positions);
    writeJSON(keys.watched, this.watched);
    writeJSON(keys.matchOverrides, this.overrides);
    this.emit();
  }

  // MARK: Refreshing

  /** `afterChanges`: put.io just changed (the folder merge), so an update already running doesn't count.
   * `seasonCount` lets a show without the file's season be ruled out (pickShow). */
  refresh(putio: PutioClient, search: Searcher, scope: LibraryScope = standardScope, options: { afterChanges?: boolean; seasonCount?: SeasonCounter } = {}): Promise<void> {
    if (options.afterChanges && this.refreshing) return this.refreshing.then(() => this.refresh(putio, search, scope, { seasonCount: options.seasonCount }));
    this.refreshing ??= this.run(putio, search, scope, options.seasonCount).finally(() => {
      this.refreshing = undefined;
      this.isRefreshing = false;
      this.progressText = "";
      this.emit();
    });
    return this.refreshing;
  }

  private async run(putio: PutioClient, search: Searcher, scope: LibraryScope, seasonCount?: SeasonCounter) {
    this.isRefreshing = true;
    const startedAt = Date.now();
    const refreshedBefore = this.snapshot.updatedAt > 0;
    this.lookups.clear();
    this.searches.clear();
    this.progressText = "Reading your put.io…";
    this.emit();
    let videos: Awaited<ReturnType<LibraryIndex["walk"]>>;
    const folders: Record<string, number> = {};
    try {
      videos = await this.walk(putio, scope, folders);
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
        // Fix Match choices come first: those files are never looked up.
        const chosen = overrideFor(this.overrides, file, folderChain(file.parent_id, folders));
        entries[index] = {
          id: file.id, name: file.name, size: file.size, createdAt: file.created_at, updatedAt: file.updated_at,
          startFrom: file.start_from ?? 0, parentID: file.parent_id, folderName: folder, grandparentName: grandparent,
          match: chosen ? applyOverride(chosen, file.name, folder, grandparent) : await this.match(file.name, folder, grandparent, search, seasonCount),
        };
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    this.notePositionsFromList(entries, startedAt, refreshedBefore);
    // A Fix Match made while this update ran wins too.
    this.snapshot = { entries: this.withOverrides(entries, folders), updatedAt: Date.now(), scope: scopeSignature(scope), folders };
    writeJSON(keys.library, this.snapshot);
    writeJSON(keys.matches, this.matches);
  }

  /** The list's start_from isn't in put.io's API definition, so only a position it does give counts; a missing or 0
   * value never removes one. Positions are never dropped by a refresh, except old ones of files that are gone. */
  private notePositionsFromList(entries: LibraryEntry[], startedAt: number, refreshedBefore: boolean) {
    const next: Record<number, Position> = { ...this.positions };
    const marks = { ...this.watched };
    for (const e of entries) {
      if (e.startFrom <= 0) continue;
      const incoming = putioRead(e.startFrom, startedAt, refreshedBefore ? startedAt : undefined);
      const merged = mergePosition(next[e.id], incoming);
      const mark = markAfter(marks[e.id], next[e.id], merged, incoming);
      if (mark === undefined) delete marks[e.id]; else marks[e.id] = mark;
      next[e.id] = merged;
    }
    const present = new Set(entries.map((e) => e.id));
    const cutoff = Date.now() - KEEP_GONE_POSITIONS_MS;
    this.positions = Object.fromEntries(Object.entries(next).filter(([id, p]) => present.has(Number(id)) || p.pending || p.at >= cutoff));
    this.watched = Object.fromEntries(Object.entries(marks).filter(([id, at]) => present.has(Number(id)) || at >= cutoff));
    writeJSON(keys.positions, this.positions);
    writeJSON(keys.watched, this.watched);
  }

  /** Breadth-first through what `scope` covers: the top of put.io (its loose videos and in-scope folders), everything
   * below those, and the folders picked in Settings. */
  async walk(putio: Pick<PutioClient, "list">, scope: LibraryScope = standardScope, folders: Record<string, number> = {}) {
    const found: { file: PutioFile; folder?: string; grandparent?: string }[] = [];
    let queue: { id: number; name?: string; parentName?: string }[] = [
      { id: 0 },
      ...scope.pickedFolders.map((f) => ({ id: f.id, name: f.path.split("/").at(-1) ?? f.path, parentName: f.path.split("/").at(-2) })),
    ];
    const queued = new Set(queue.map((f) => f.id));
    const seen = new Set<number>();
    let read = 0;
    while (queue.length && read < MAX_FOLDERS) {
      const batch = queue.splice(0, 6);
      read += batch.length;
      // The top folder must be readable (else the sign-in is bad); a folder deeper down (or a picked one that's gone)
      // may fail alone.
      const lists = await Promise.all(batch.map((f) => (f.id === 0 ? putio.list(0) : putio.list(f.id).catch(() => ({ files: [] as PutioFile[] })))));
      lists.forEach((list, i) => {
        const atTop = batch[i].id === 0;
        for (const file of list.files) {
          if (isFolder(file)) {
            const reads = atTop ? includesTopLevelFolder(scope, file) : !SKIPPED_FOLDERS.has(file.name.trim().toLowerCase());
            if (reads && !queued.has(file.id)) {
              queued.add(file.id);
              folders[file.id] = batch[i].id;
              queue.push({ id: file.id, name: file.name, parentName: batch[i].name });
            }
          } else if (isVideo(file) && !/\bsample\b/i.test(file.name) && !seen.has(file.id)) {
            seen.add(file.id);
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

  private async match(fileName: string, folder: string | undefined, grandparent: string | undefined, search: Searcher, seasonCount?: SeasonCounter): Promise<LibraryMatch | undefined> {
    const parsed = describeVideo(fileName, folder, grandparent);
    if (!parsed.title) return undefined;
    const kind: MediaKind = parsed.season !== undefined ? "tv" : "movie";
    const key = matchKey(parsed);
    let cached = this.matches[key];
    if (cached === undefined) {
      // Episodes of one show are matched side by side: they share one lookup.
      let lookup = this.lookups.get(key);
      if (!lookup) {
        lookup = this.lookUp(kind, parsed, search, seasonCount).then((found) => {
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

  /** Movies are searched with their year; shows without it, then picked with it (pickShow). */
  private async lookUp(kind: MediaKind, parsed: { title: string; year?: number; season?: number }, search: Searcher, seasonCount?: SeasonCounter): Promise<CachedMatch> {
    const year = kind === "movie" ? parsed.year : undefined;
    const searchKey = `${kind}|${normalizeTitle(parsed.title)}|${year ?? ""}`;
    let results = this.searches.get(searchKey);
    if (!results) {
      results = search(kind, parsed.title, year);
      this.searches.set(searchKey, results);
      results.catch(() => this.searches.delete(searchKey));
    }
    const items = await results;
    const best = kind === "tv"
      ? await pickShow(items, parsed.title, parsed.year, parsed.season ?? 1, (id) => this.seasonCount(id, seasonCount))
      : pickMatch(items, parsed.title, year);
    if (!best) return null;
    const { tmdbID, title, year: itemYear, posterPath, backdropPath } = best.item;
    return { tmdbID, kind, title, year: itemYear, posterPath, backdropPath, confidence: best.confidence };
  }

  private seasonCount(tmdbID: number, lookUp?: SeasonCounter): Promise<number | undefined> {
    if (!lookUp) return Promise.resolve(undefined);
    let count = this.seasonCounts.get(tmdbID);
    if (!count) {
      count = lookUp(tmdbID).catch(() => {
        this.seasonCounts.delete(tmdbID);
        return undefined;
      });
      this.seasonCounts.set(tmdbID, count);
    }
    return count;
  }

  // MARK: Fix Match

  private chainOf(parentID: number | undefined): number[] {
    return folderChain(parentID, this.snapshot.folders ?? {});
  }

  /** The Fix Match choice behind a file's match, if any. */
  overrideOf(file: { id: number; name: string; parentID?: number }): MatchOverride | undefined {
    return overrideFor(this.overrides, file, this.chainOf(file.parentID));
  }

  /** Whether Match Automatically has anything to undo for these files (or this folder). */
  hasOverride(files: { id: number; name: string; parentID?: number }[], folderID?: number): boolean {
    return (folderID !== undefined && Boolean(this.overrides.folders[folderID])) || files.some((f) => this.overrideOf(f));
  }

  private withOverrides(entries: LibraryEntry[], folders = this.snapshot.folders ?? {}): LibraryEntry[] {
    return entries.map((e) => {
      const chosen = overrideFor(this.overrides, e, folderChain(e.parentID, folders));
      return chosen ? { ...e, match: applyOverride(chosen, e.name, e.folderName, e.grandparentName) } : e;
    });
  }

  private saveEntries(entries: LibraryEntry[]) {
    this.snapshot = { ...this.snapshot, entries };
    writeJSON(keys.library, this.snapshot);
    this.emit();
  }

  /** Saves the choice for `target` and shows it at once on every library file it covers. */
  fixMatch(target: FixMatchTarget, chosen: MatchOverride) {
    this.overrides = withOverride(this.overrides, target, chosen);
    writeJSON(keys.matchOverrides, this.overrides);
    this.saveEntries(this.withOverrides(this.entries));
  }

  /** Match Automatically: forgets every choice covering these files (their own, any folder above them, their name)
   * and the folder's own, then matches every library file that lost its choice like a new one (its old automatic
   * verdict is what Fix Match was correcting). Returns how many files went back to automatic matching. */
  async matchAutomatically(files: { id: number; name: string; parentID?: number }[], folderID: number | undefined, search: Searcher, seasonCount?: SeasonCounter): Promise<number> {
    const before = this.entries.filter((e) => this.overrideOf(e));
    this.overrides = withoutOverrides(this.overrides, files.map((f) => ({ ...f, chain: this.chainOf(f.parentID) })), folderID);
    writeJSON(keys.matchOverrides, this.overrides);
    const released = new Set(before.filter((e) => !this.overrideOf(e)).map((e) => e.id));
    for (const e of this.entries) {
      if (released.has(e.id)) delete this.matches[matchKey(describeVideo(e.name, e.folderName, e.grandparentName))];
    }
    this.lookups.clear();
    this.searches.clear();
    const entries = await Promise.all(this.entries.map(async (e) => (released.has(e.id)
      ? { ...e, match: await this.match(e.name, e.folderName, e.grandparentName, search, seasonCount) }
      : e)));
    writeJSON(keys.matches, this.matches);
    // Changes made meanwhile (another Fix Match) still win.
    this.saveEntries(this.withOverrides(entries));
    return released.size;
  }
}

export const library = new LibraryIndex();
