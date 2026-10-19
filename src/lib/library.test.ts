import { beforeEach, describe, expect, it } from "vitest";
import type { PutioClient, PutioFile } from "../api/putio";
import { describeVideo, LibraryIndex } from "./library";
import { includesTopLevelFolder, libraryScope, standardScope } from "./libraryScope";

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
