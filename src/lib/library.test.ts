import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PutioError, type PutioClient, type PutioFile } from "../api/putio";
import { describeVideo, LibraryIndex, type LibraryEntry } from "./library";
import { includesTopLevelFolder, libraryScope, standardScope } from "./libraryScope";
import { PositionSync } from "./positionSync";

beforeEach(() => {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe("describeVideo", () => {
  it("takes a season pack episode's show and season from its folder", () => {
    expect(describeVideo("E04 - Woe's Hollow.mkv", "Severance.S02.1080p.WEB")).toMatchObject({ title: "Severance", season: 2, episode: 4 });
  });

  it("uses Show/Season N folders", () => {
    expect(describeVideo("04. Woe's Hollow.mkv", "Season 2", "Severance")).toMatchObject({ title: "Severance", season: 2, episode: 4 });
  });

  it("keeps a full name as it is", () => {
    expect(describeVideo("Heat.1995.1080p.BluRay.mkv", "Movies")).toMatchObject({ title: "Heat", year: 1995 });
  });
});

describe("LibraryIndex", () => {
  const file = (id: number, name: string, extra: Partial<PutioFile> = {}): PutioFile => ({ id, name, file_type: "VIDEO", ...extra });
  const tree: Record<number, PutioFile[]> = {
    0: [{ id: 9, name: "TV Series", file_type: "FOLDER" }, file(1, "Heat.1995.1080p.mkv", { start_from: 600, created_at: "2026-10-01", updated_at: "2026-10-03" })],
    9: [{ id: 10, name: "Severance.S02.1080p", file_type: "FOLDER" }, { id: 11, name: "Subs", file_type: "FOLDER" }],
    10: [file(2, "Severance.S02E04.1080p.mkv", { start_from: 1250, created_at: "2026-10-11", updated_at: "2026-10-12" }), file(3, "E05.mkv", { created_at: "2026-10-12" }), file(4, "sample.mkv")],
    11: [file(5, "never-read.mkv")],
  };
  const putio = { list: async (id: number) => ({ files: tree[id] ?? [] }) } as unknown as PutioClient;
  let lookups = 0;
  const search = async (kind: "movie" | "tv", title: string) => {
    lookups++;
    return kind === "tv" ? [{ tmdbID: 95396, title: "Severance", year: 2022 }] : [{ tmdbID: 949, title, year: 1995 }];
  };

  it("finds videos, skips samples and subtitle folders, and matches each name once", async () => {
    lookups = 0;
    const index = new LibraryIndex();
    await index.refresh(putio, search);
    expect(index.entries.map((e) => e.id).sort()).toEqual([1, 2, 3]);
    expect(index.matching(95396, 2).map((e) => e.match?.episode).sort()).toEqual([4, 5]);
    expect(lookups).toBe(2);
    expect(index.continueWatching().map((e) => e.id)).toEqual([2, 1]);
  });

  it("shows how much is left from the player's length, else the estimate", async () => {
    const index = new LibraryIndex();
    await index.refresh(putio, search);
    const episode = index.entries.find((e) => e.id === 2)!;
    expect(index.remainingSeconds(episode, 3360)).toBe(2110);
    index.noteProgress(2, 1250, 3300);
    expect(index.remainingSeconds(episode, 3360)).toBe(2050);
    expect(index.watchedFraction(index.entries.find((e) => e.id === 3)!)).toBeUndefined();
  });
});

describe("library scope", () => {
  const folder = (id: number, name: string): PutioFile => ({ id, name, file_type: "FOLDER" });
  const video = (id: number, name: string): PutioFile => ({ id, name, file_type: "VIDEO" });
  const tree: Record<number, PutioFile[]> = {
    0: [video(1, "Loose.Movie.2020.mkv"), { id: 2, name: "notes.txt", file_type: "TEXT" }, folder(10, "MOVIES"), folder(20, " tv series"),
      folder(30, "Downloads"), folder(40, "AMDB"), folder(50, "Media")],
    10: [folder(11, "Dune.2021.1080p")],
    11: [video(111, "Dune.2021.1080p.mkv"), folder(12, "Subs")],
    12: [video(121, "never.read.mkv")],
    20: [folder(21, "Severance")],
    21: [folder(22, "Season 2")],
    22: [video(221, "Severance.S02E04.mkv")],
    30: [video(301, "Other.2019.mkv")],
    40: [folder(41, "TV")],
    41: [video(411, "Old.S01E01.mkv")],
    50: [folder(51, "Films")],
    51: [video(511, "Picked.2022.mkv")],
  };
  const putio = {
    list: async (id: number) => {
      if (!(id in tree)) throw new Error("gone");
      return { files: tree[id] };
    },
  };
  const ids = (found: { file: PutioFile }[]) => found.map((f) => f.file.id).sort((a, b) => a - b);

  it("reads Movies and TV Series at any depth (ignoring case) and loose videos at the top, nothing else", async () => {
    const found = await new LibraryIndex().walk(putio);
    expect(ids(found)).toEqual([1, 111, 221]);
    expect(found.find((f) => f.file.id === 221)).toMatchObject({ folder: "Season 2", grandparent: "Severance" });
  });

  it("also reads folders picked in Settings, wherever they are (a gone one is skipped)", async () => {
    const scope = libraryScope({ moviesFolder: { id: 51, path: "Media/Films" }, tvFolder: { id: 999, path: "Gone/Shows" } });
    expect(ids(await new LibraryIndex().walk(putio, scope))).toEqual([1, 111, 221, 511]);
    const inside = libraryScope({ moviesFolder: { id: 11, path: "Movies/Dune.2021.1080p" }, tvFolder: null });
    expect(ids(await new LibraryIndex().walk(putio, inside))).toEqual([1, 111, 221]);
  });

  it("matches top-level folders ignoring case only", () => {
    expect(includesTopLevelFolder(standardScope, folder(1, "movies"))).toBe(true);
    expect(includesTopLevelFolder(standardScope, folder(2, "TV SERIES "))).toBe(true);
    expect(includesTopLevelFolder(standardScope, folder(3, "TV"))).toBe(false);
    expect(includesTopLevelFolder(standardScope, folder(4, "Movies 4K"))).toBe(false);
  });

  it("is just the loose videos while Movies and TV Series don't exist", async () => {
    const bare = { list: async (id: number) => ({ files: id === 0 ? [video(1, "Loose.Movie.2020.mkv"), folder(30, "Downloads")] : [video(301, "x.mkv")] }) };
    expect(ids(await new LibraryIndex().walk(bare))).toEqual([1]);
  });

  it("reads put.io again when the cache was made with another scope", async () => {
    localStorage.setItem("pc.library.v1", JSON.stringify({ entries: [{ id: 301, name: "Other.2019.mkv", startFrom: 0 }], updatedAt: Date.now() }));
    const index = new LibraryIndex();
    expect(index.needsRescan(standardScope)).toBe(true);
    await index.refresh(putio as unknown as PutioClient, async () => [], standardScope);
    expect(index.entries.map((e) => e.id).sort((a, b) => a - b)).toEqual([1, 111, 221]);
    expect(index.needsRescan(standardScope)).toBe(false);
    expect(index.needsRescan(libraryScope({ moviesFolder: { id: 51, path: "Media/Films" }, tvFolder: null }))).toBe(true);
  });
});

describe("watch positions across devices", () => {
  const T = Date.parse("2026-10-19T12:00:00Z");
  const at = (seconds: number) => vi.setSystemTime(T + seconds * 1000);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); at(0); });
  afterEach(() => vi.useRealTimers());

  const heat: LibraryEntry = { id: 1, name: "Heat.1995.mkv", startFrom: 0, updatedAt: "2026-10-03", match: { tmdbID: 949, kind: "movie", title: "Heat" } };
  const ep4: LibraryEntry = { id: 2, name: "Severance.S02E04.mkv", startFrom: 0, updatedAt: "2026-10-12", match: { tmdbID: 95396, kind: "tv", title: "Severance", season: 2, episode: 4 } };
  const ep5: LibraryEntry = { id: 3, name: "Severance.S02E05.mkv", startFrom: 0, updatedAt: "2026-10-13", match: { tmdbID: 95396, kind: "tv", title: "Severance", season: 2, episode: 5 } };
  /** What another device left in localStorage: the library read an hour ago. */
  const cachedLibrary = (entries: LibraryEntry[] = [heat, ep4, ep5]) =>
    localStorage.setItem("pc.library.v1", JSON.stringify({ entries, updatedAt: T - 3600_000, scope: "standard" }));

  /** put.io's start-from, as the native apps and other browsers leave it; a full read of put.io fails the test. */
  function fakePutio(positions: Record<number, number> = {}) {
    const calls: string[] = [];
    let failures = 0;
    return {
      calls,
      positions,
      failNextSaves: (n: number) => { failures = n; },
      list: async () => { throw new Error("no full refresh expected"); },
      getStartFrom: async (id: number) => {
        calls.push(`get ${id}`);
        if (!(id in positions)) throw new PutioError(404, "File not found");
        return positions[id];
      },
      setStartFrom: async (id: number, seconds: number) => {
        calls.push(`set ${id} ${seconds}`);
        if (failures-- > 0) throw new Error("offline");
        positions[id] = seconds;
      },
      resetStartFrom: async (id: number) => {
        calls.push(`reset ${id}`);
        if (failures-- > 0) throw new Error("offline");
        positions[id] = 0;
      },
    };
  }
  const resume = (index: LibraryIndex, id: number) => index.resumeSeconds(index.entries.find((e) => e.id === id)!);

  it("shows a position saved on another device after a foreground check, without reading all of put.io", async () => {
    cachedLibrary();
    const index = new LibraryIndex();
    expect(index.continueWatching()).toEqual([]);
    const putio = fakePutio({ 1: 0, 2: 1800, 3: 0 });
    await new PositionSync(index, 0).check(putio);
    expect(resume(index, 2)).toBe(1800);
    expect(index.continueWatching().map((e) => e.id)).toEqual([2]);
    expect(putio.calls.filter((c) => c.startsWith("get")).sort()).toEqual(["get 1", "get 2", "get 3"]);
  });

  it("checks at most 20 started videos, leaving room for the 10 latest changed ones", () => {
    const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
    const started = Array.from({ length: 25 }, (_, i): LibraryEntry => ({ id: 100 + i, name: `s${i}.mkv`, startFrom: 600, updatedAt: day(1) }));
    const fresh = Array.from({ length: 12 }, (_, i): LibraryEntry => ({ id: 200 + i, name: `f${i}.mkv`, startFrom: 0, updatedAt: day(10 + i) }));
    cachedLibrary([...started, ...fresh]);
    const index = new LibraryIndex();
    started.forEach((e, i) => index.notePutioPosition(e.id, 600, T + i * 1000)); // Later ids watched later.
    const ids = index.positionCandidates();
    expect(ids).toHaveLength(30);
    expect(ids.slice(0, 20)).toEqual(started.slice(5).reverse().map((e) => e.id));
    expect(ids.slice(20)).toEqual(fresh.slice(2).reverse().map((e) => e.id));
    expect(index.positionCandidates(12)).toEqual([124, 123, ...fresh.slice(2).reverse().map((e) => e.id)]);
  });

  it("skips a file put.io no longer has (404) and still merges the rest", async () => {
    cachedLibrary();
    const index = new LibraryIndex();
    await new PositionSync(index, 0).check(fakePutio({ 1: 900 }));
    expect(index.continueWatching().map((e) => e.id)).toEqual([1]);
  });

  it("keeps a position saved here when a refresh's list has no start_from, and after a reload", async () => {
    const tree: Record<number, PutioFile[]> = { 0: [{ id: 1, name: "Heat.1995.1080p.mkv", file_type: "VIDEO", updated_at: "2026-10-03" }] };
    const putio = { list: async (id: number) => ({ files: tree[id] ?? [] }) } as unknown as PutioClient;
    const search = async () => [{ tmdbID: 949, title: "Heat", year: 1995 }];
    const index = new LibraryIndex();
    await index.refresh(putio, search);
    const saved = index.noteProgress(1, 700, 6000);
    index.markSent(1, saved.at); // put.io took it, but its list doesn't say so.
    at(60);
    await index.refresh(putio, search);
    expect(resume(index, 1)).toBe(700);
    expect(index.continueWatching().map((e) => e.id)).toEqual([1]);
    expect(resume(new LibraryIndex(), 1)).toBe(700);
  });

  it("takes a list's position only when it's newer than what's known here", async () => {
    let startFrom = 1000;
    const putio = { list: async () => ({ files: [{ id: 1, name: "Heat.1995.mkv", file_type: "VIDEO", start_from: startFrom }] }) } as unknown as PutioClient;
    const search = async () => [{ tmdbID: 949, title: "Heat", year: 1995 }];
    const index = new LibraryIndex();
    await index.refresh(putio, search);
    expect(resume(index, 1)).toBe(1000);
    expect(index.position(1)?.watchedAt).toBeUndefined(); // The first read can't tell when it was watched.
    at(10);
    index.noteProgress(1, 1500); // Not yet on put.io: the list's older value loses.
    at(20);
    await index.refresh(putio, search);
    expect(resume(index, 1)).toBe(1500);
    index.markSent(1, T + 10_000);
    at(30);
    startFrom = 2400; // Watched further on another device.
    await index.refresh(putio, search);
    expect(index.position(1)).toMatchObject({ seconds: 2400, source: "putio", watchedAt: T + 30_000 });
  });

  it("newest wins: a pending save here beats an older put.io read; a later read replaces a synced one", async () => {
    cachedLibrary();
    const index = new LibraryIndex();
    const putio = fakePutio({ 2: 100 });
    putio.failNextSaves(2);
    const sync = new PositionSync(index, 0);
    at(10);
    await sync.save(putio, 2, 300, 3300);
    expect(index.position(2)).toMatchObject({ seconds: 300, pending: true });
    at(20);
    await sync.fetch(putio, 2, 1000); // Still 100 on put.io: our save hasn't reached it.
    expect(resume(index, 2)).toBe(300);
    putio.positions[2] = 300;
    at(30);
    await sync.fetch(putio, 2, 1000); // put.io has it now.
    expect(index.position(2)).toMatchObject({ seconds: 300, pending: false });
    putio.positions[2] = 2000;
    at(40);
    await sync.fetch(putio, 2, 1000); // Watched on another device since.
    expect(index.position(2)).toMatchObject({ seconds: 2000, source: "putio", watchedAt: T + 40_000 });
  });

  it("orders Continue Watching by when it was last watched anywhere, one card per show", async () => {
    cachedLibrary();
    const index = new LibraryIndex();
    const sync = new PositionSync(index, 0);
    const putio = fakePutio({ 1: 0, 2: 0, 3: 0 });
    await sync.save(putio, 2, 1200, 3300);
    at(10);
    await sync.save(putio, 3, 400, 3300);
    at(20);
    await sync.save(putio, 1, 900, 6000);
    expect(index.continueWatching().map((e) => e.id)).toEqual([1, 3]);
    putio.positions[2] = 1500;
    at(30);
    await sync.check(putio);
    expect(index.continueWatching().map((e) => e.id)).toEqual([2, 1]);
  });

  it("drops a video finished on another device from Continue Watching", async () => {
    cachedLibrary([{ ...heat, startFrom: 900 }, ep4]);
    const index = new LibraryIndex();
    const sync = new PositionSync(index, 0);
    const putio = fakePutio({ 1: 900, 2: 1250 });
    await sync.check(putio);
    expect(index.continueWatching().map((e) => e.id).sort()).toEqual([1, 2]);
    putio.positions[2] = 0;
    at(31);
    await sync.check(putio);
    expect(index.position(2)).toMatchObject({ seconds: 0 });
    expect(index.continueWatching().map((e) => e.id)).toEqual([1]);
  });

  it("resets put.io's position when watched to the end", async () => {
    cachedLibrary();
    const index = new LibraryIndex();
    const putio = fakePutio({ 2: 1250 });
    await new PositionSync(index, 0).save(putio, 2, 3200, 3300);
    expect(putio.calls).toEqual(["reset 2"]);
    expect(index.position(2)).toMatchObject({ seconds: 0, pending: false });
  });

  it("keeps a save put.io didn't take (after one retry) and sends it at the next check", async () => {
    cachedLibrary();
    const index = new LibraryIndex();
    const putio = fakePutio({ 2: 100 });
    putio.failNextSaves(2);
    await new PositionSync(index, 0).save(putio, 2, 700, 3300);
    expect(putio.calls).toEqual(["set 2 700", "set 2 700"]);
    // Still waiting after a reload.
    const reloaded = new LibraryIndex();
    expect(reloaded.position(2)).toMatchObject({ seconds: 700, pending: true });
    at(5);
    const sync = new PositionSync(reloaded, 0);
    await sync.check(putio);
    expect(putio.positions[2]).toBe(700);
    expect(putio.calls.indexOf("set 2 700", 2)).toBeLessThan(putio.calls.indexOf("get 2"));
    expect(reloaded.position(2)).toMatchObject({ seconds: 700, pending: false });
    // Within 30 s a check only sends what's waiting.
    putio.calls.length = 0;
    await sync.check(putio);
    expect(putio.calls).toEqual([]);
  });

  it("brings over positions an older build kept in the library cache", () => {
    localStorage.setItem("pc.library.v1", JSON.stringify({ entries: [heat], updatedAt: T - 1000, progress: { 1: 640 } }));
    expect(new LibraryIndex().position(1)).toEqual({ seconds: 640, at: T - 1000, source: "device", pending: false });
  });
});
