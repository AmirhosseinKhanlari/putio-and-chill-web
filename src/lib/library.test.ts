import { beforeEach, describe, expect, it } from "vitest";
import type { PutioClient, PutioFile } from "../api/putio";
import { describeVideo, LibraryIndex } from "./library";

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
    0: [{ id: 10, name: "Severance.S02.1080p", file_type: "FOLDER" }, file(1, "Heat.1995.1080p.mkv", { start_from: 600, created_at: "2026-10-01", updated_at: "2026-10-03" }), { id: 11, name: "Subs", file_type: "FOLDER" }],
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
