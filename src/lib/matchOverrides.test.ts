import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PutioClient, PutioFile } from "../api/putio";
import { applyOverride, LibraryIndex } from "./library";
import { entriesRequest, folderChain, folderRequest, nameKey, overrideFor, suggestedQuery, targetLabel, videoRequest, type MatchOverride } from "./matchOverrides";

const edGein: MatchOverride = { tmdbID: 286801, mediaType: "tv", title: "Monster: The Ed Gein Story", year: 2025, season: 1 };
const anime: MatchOverride = { tmdbID: 30981, mediaType: "tv", title: "Monster", year: 2004 };
const heat: MatchOverride = { tmdbID: 949, mediaType: "movie", title: "Heat", year: 1995 };

describe("a Fix Match choice", () => {
  it("keeps each name's episode and sets the season (or keeps the named one)", () => {
    expect(applyOverride(edGein, "Monster.2022.S03E05.1080p.mkv")).toMatchObject({ tmdbID: 286801, kind: "tv", season: 1, episode: 5, confidence: 1 });
    expect(applyOverride({ ...edGein, season: undefined }, "Monster.2022.S03E05.mkv")).toMatchObject({ season: 3, episode: 5 });
    expect(applyOverride({ ...edGein, season: undefined }, "05 - Episode.mkv")).toMatchObject({ season: 1, episode: 5 });
    expect(applyOverride({ ...edGein, season: undefined }, "E04 - Woe's Hollow.mkv", "Season 2", "Severance")).toMatchObject({ season: 2, episode: 4 });
    expect(applyOverride(heat, "Heat.1995.mkv")).toEqual({ tmdbID: 949, kind: "movie", title: "Heat", year: 1995, posterPath: undefined, backdropPath: undefined, confidence: 1 });
  });

  it("is keyed by name with the title, year and season", () => {
    expect(nameKey("Monster.2022.S03E05.mkv")).toBe("monster|2022|s3");
    expect(nameKey("Monster.2022.S03E05.mkv")).toBe(nameKey("Monster 2022 S03E01 720p"));
    expect(nameKey("Monster.2022.S03E05.mkv")).not.toBe(nameKey("Monster.2022.S02E05.mkv"));
    expect(nameKey("Monster.S03E05.mkv")).toBe("monster||s3");
    expect(nameKey("Heat.1995.1080p.mkv")).toBe("heat|1995|movie");
    expect(nameKey("1080p.mkv")).toBeUndefined();
  });

  it("is looked up on the file, then the nearest folder, then the name", () => {
    const overrides = { files: { 31: anime }, folders: { 3: heat, 2: edGein }, names: { "monster|2022|s3": anime } };
    const chain = folderChain(3, { 3: 2, 2: 1, 1: 0 });
    expect(chain).toEqual([3, 2, 1]);
    expect(folderChain(5, { 5: 6, 6: 5 })).toEqual([5, 6]);
    expect(overrideFor(overrides, { id: 31, name: "x.mkv" }, chain)).toBe(anime);
    expect(overrideFor(overrides, { id: 32, name: "x.mkv" }, chain)).toBe(heat);
    expect(overrideFor(overrides, { id: 32, name: "x.mkv" }, [2, 1])).toBe(edGein);
    expect(overrideFor(overrides, { id: 40, name: "Monster.2022.S03E09.mkv" }, [])).toBe(anime);
    expect(overrideFor(overrides, { id: 40, name: "Other.S01E01.mkv" }, [])).toBeUndefined();
  });

  it("offers this file, its folder and its name; a show card's files; a folder", () => {
    const file = { id: 31, name: "Monster.2022.S03E01.1080p.mkv", parentID: 3 };
    const request = videoRequest(file, "Season 3");
    expect(request.targets.map(targetLabel)).toEqual(["This file only", "Everything in “Season 3”", "All files named “Monster 2022” season 3"]);
    expect(videoRequest({ id: 1, name: "Heat.1995.mkv", parentID: 0 }).targets.map(targetLabel)).toEqual(["This file only", "All files named “Heat 1995”"]);
    expect(entriesRequest([file, { id: 32, name: "Monster.2022.S03E02.mkv", parentID: 3 }]).targets.map(targetLabel)).toEqual(["These 2 files"]);
    expect(folderRequest({ id: 2, name: "Monster (2022)" })).toMatchObject({ folderID: 2, targets: [{ kind: "folder", id: 2 }] });
    expect(suggestedQuery("Monster.2022.S03E01.1080p.mkv")).toBe("Monster");
    expect(suggestedQuery("Monster (2022)")).toBe("Monster");
  });
});

describe("Fix Match in the library", () => {
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
  afterEach(() => { (globalThis as { localStorage?: Storage }).localStorage = undefined; });

  const folder = (id: number, name: string, parent: number): PutioFile => ({ id, name, file_type: "FOLDER", parent_id: parent });
  const video = (id: number, name: string, parent: number): PutioFile => ({ id, name, file_type: "VIDEO", parent_id: parent });
  /** TV Series / Monster (2022) / Season 3 / two episodes, a loose copy of episode 1, the anime, Ed Gein, a movie. */
  const tree: Record<number, PutioFile[]> = {
    0: [folder(1, "TV Series", 0)],
    1: [folder(2, "Monster (2022)", 1), video(40, "Monster.S03E01.720p.mkv", 1), video(50, "Monster.The.Ed.Gein.Story.S01E08.1080p.mkv", 1),
      video(51, "Monster.S01E05.1080p.BluRay.mkv", 1), video(60, "Some.Odd.Film.2020.mkv", 1)],
    2: [folder(3, "Season 3", 2)],
    3: [video(31, "Monster.2022.S03E01.1080p.NF.WEB-DL.mkv", 3), video(32, "Monster.2022.S03E02.1080p.NF.WEB-DL.mkv", 3)],
  };
  const putio = { list: async (id: number) => ({ files: tree[id] ?? [] }) } as unknown as PutioClient;
  const searched: string[] = [];
  const search = async (kind: "movie" | "tv", title: string) => {
    searched.push(`${kind}:${title}`);
    if (kind === "movie") return [];
    return [{ tmdbID: 30981, title: "Monster", year: 2004 }, { tmdbID: 286801, title: "Monster: The Ed Gein Story", year: 2025 }];
  };
  const seasonCount = async (id: number) => ({ 30981: 1, 286801: 1 })[id];
  const refresh = (index: LibraryIndex) => index.refresh(putio, search, undefined, { seasonCount });
  const match = (index: LibraryIndex, id: number) => index.entries.find((e) => e.id === id)?.match;
  const file = (id: number) => { const f = Object.values(tree).flat().find((x) => x.id === id)!; return { id: f.id, name: f.name, parentID: f.parent_id }; };

  it("matches by year and season count, leaving the anthology's season 3 unmatched", async () => {
    const index = new LibraryIndex();
    await refresh(index);
    expect([31, 32, 40].map((id) => match(index, id))).toEqual([undefined, undefined, undefined]);
    expect(match(index, 50)).toMatchObject({ tmdbID: 286801, season: 1, episode: 8 });
    expect(match(index, 51)).toMatchObject({ tmdbID: 30981, season: 1, episode: 5 });
  });

  it("applies a folder fix at once and on every update, from a new index too", async () => {
    const index = new LibraryIndex();
    await refresh(index);
    index.fixMatch({ kind: "folder", id: 2, name: "Monster (2022)" }, edGein);
    expect(match(index, 31)).toMatchObject({ tmdbID: 286801, kind: "tv", season: 1, episode: 1, confidence: 1 });
    expect(match(index, 32)).toMatchObject({ tmdbID: 286801, season: 1, episode: 2 });
    expect(match(index, 40)).toBeUndefined();
    // The title page reads the library by show, season and episode.
    expect(index.matching(286801, 1, 2).map((e) => e.id)).toEqual([32]);

    const again = new LibraryIndex();
    await refresh(again);
    expect(match(again, 31)).toMatchObject({ tmdbID: 286801, season: 1, episode: 1 });
    expect(match(again, 32)).toMatchObject({ season: 1, episode: 2 });
  });

  it("never looks up a file with a choice", async () => {
    const index = new LibraryIndex();
    index.fixMatch({ kind: "files", ids: [60] }, heat);
    searched.length = 0;
    await refresh(index);
    expect(match(index, 60)).toMatchObject({ tmdbID: 949, kind: "movie" });
    expect(searched).not.toContain("movie:Some Odd Film");
  });

  it("lets a file's own choice win over its folder's", async () => {
    const index = new LibraryIndex();
    await refresh(index);
    index.fixMatch({ kind: "folder", id: 2, name: "Monster (2022)" }, edGein);
    index.fixMatch({ kind: "files", ids: [32] }, anime);
    expect(match(index, 31)?.tmdbID).toBe(286801);
    expect(match(index, 32)).toMatchObject({ tmdbID: 30981, season: 3, episode: 2 });
    await refresh(index);
    expect(match(index, 32)?.tmdbID).toBe(30981);
  });

  it("covers files named alike in other folders, but not another year", async () => {
    const index = new LibraryIndex();
    await refresh(index);
    index.fixMatch({ kind: "name", fileName: "Monster.S03E01.720p.mkv" }, edGein);
    expect(match(index, 40)).toMatchObject({ tmdbID: 286801, season: 1, episode: 1 });
    expect(match(index, 31)).toBeUndefined();
  });

  it("undoes with Match Automatically: the choice goes and every file it covered is matched again", async () => {
    const index = new LibraryIndex();
    await refresh(index);
    index.fixMatch({ kind: "folder", id: 2, name: "Monster (2022)" }, edGein);
    expect(index.hasOverride([file(31)])).toBe(true);
    expect(await index.matchAutomatically([file(31)], undefined, search, seasonCount)).toBe(2);
    expect(index.hasOverride([file(31)])).toBe(false);
    expect(match(index, 31)).toBeUndefined();
    expect(match(index, 32)).toBeUndefined();
    expect(JSON.parse(localStorage.getItem("pc.matchOverrides.v1")!)).toEqual({ files: {}, folders: {}, names: {} });
    await refresh(index);
    expect(match(index, 31)).toBeUndefined();
  });

  it("undoes a fix of a folder from the folder, and a file fix back to its automatic match", async () => {
    const index = new LibraryIndex();
    await refresh(index);
    index.fixMatch({ kind: "folder", id: 3, name: "Season 3" }, edGein);
    index.fixMatch({ kind: "files", ids: [50] }, anime);
    expect(index.hasOverride([], 3)).toBe(true);
    expect(await index.matchAutomatically([], 3, search, seasonCount)).toBe(2);
    expect(match(index, 31)).toBeUndefined();
    expect(await index.matchAutomatically([file(50)], undefined, search, seasonCount)).toBe(1);
    expect(match(index, 50)).toMatchObject({ tmdbID: 286801, season: 1, episode: 8 });
  });
});
