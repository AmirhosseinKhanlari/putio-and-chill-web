import { describe, expect, it } from "vitest";
import type { PutioFile } from "../../api/putio";
import { canDropInto, cleanName, daysLeft, fileDetail, idsToForget, parsePutioDate, renameSelection, sortFiles, sortTrash, summary, trashDetail } from "./fileLogic";

const folder = (id: number, name: string, extra: Partial<PutioFile> = {}): PutioFile => ({ id, name, file_type: "FOLDER", ...extra });
const video = (id: number, name: string, extra: Partial<PutioFile> = {}): PutioFile => ({ id, name, file_type: "VIDEO", ...extra });

describe("sortFiles", () => {
  const files = [
    video(1, "Episode 10.mkv", { size: 300, created_at: "2026-10-03T10:00:00" }),
    folder(2, "Season 2", { size: 100, created_at: "2026-10-01T10:00:00" }),
    video(3, "episode 2.mkv", { size: 900, created_at: "2026-10-05T10:00:00" }),
    folder(4, "Extras", { size: 5000, created_at: "2026-10-04T10:00:00" }),
  ];

  it("puts folders first, then names in natural order", () => {
    expect(sortFiles(files, "name").map((f) => f.id)).toEqual([4, 2, 3, 1]);
  });

  it("keeps folders first when newest", () => {
    expect(sortFiles(files, "newest").map((f) => f.id)).toEqual([4, 2, 3, 1]);
    expect(sortFiles([video(1, "a", { created_at: "2026-01-01T00:00:00" }), video(2, "b", { created_at: "2026-02-01T00:00:00" })], "newest")
      .map((f) => f.id)).toEqual([2, 1]);
  });

  it("mixes folders and files when largest", () => {
    expect(sortFiles(files, "largest").map((f) => f.id)).toEqual([4, 3, 1, 2]);
  });

  it("doesn't change the list it was given", () => {
    const copy = [...files];
    sortFiles(files, "largest");
    expect(files).toEqual(copy);
  });
});

describe("dates", () => {
  it("reads put.io's zone-less timestamps as UTC", () => {
    expect(parsePutioDate("2026-10-10T10:00:00")?.toISOString()).toBe("2026-10-10T10:00:00.000Z");
    expect(parsePutioDate("2026-10-10 10:00:00")?.toISOString()).toBe("2026-10-10T10:00:00.000Z");
    expect(parsePutioDate("2026-10-10")?.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(parsePutioDate("nonsense")).toBeUndefined();
    expect(parsePutioDate(undefined)).toBeUndefined();
  });

  it("counts whole days left in the trash", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    expect(daysLeft("2026-10-25T13:00:00", now)).toBe(10);
    expect(daysLeft("2026-10-15T18:00:00", now)).toBe(0);
    expect(daysLeft("2026-10-01T00:00:00", now)).toBe(0);
    expect(daysLeft(undefined, now)).toBeUndefined();
  });

  it("describes a trashed file", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const detail = trashDetail({ id: 1, name: "Old.mkv", size: 2000, deleted_at: "2026-10-01T10:00:00", expiration_date: "2026-10-16T13:00:00" }, now);
    expect(detail).toMatch(/^2 KB · Deleted .+ · Gone in 1 day$/);
    expect(trashDetail({ id: 2, name: "x", expiration_date: "2026-10-15T20:00:00" }, now)).toBe("Gone today");
  });

  it("lists the newest deletions first", () => {
    const sorted = sortTrash([{ id: 1, name: "a", deleted_at: "2026-10-01T00:00:00" }, { id: 2, name: "b", deleted_at: "2026-10-09T00:00:00" }, { id: 3, name: "c" }]);
    expect(sorted.map((f) => f.id)).toEqual([2, 1, 3]);
  });
});

describe("labels", () => {
  it("summarises a folder", () => {
    expect(summary([{ size: 1_500_000_000 }, { size: 500_000_000 }])).toBe("2 items · 2 GB");
    expect(summary([{}])).toBe("1 item");
    expect(summary([])).toBe("0 items");
  });

  it("calls an empty folder empty", () => {
    expect(fileDetail(folder(1, "New", { size: 0 }))).toBe("Empty");
    expect(fileDetail(video(1, "a.mkv", { size: 0 }))).toBe("");
  });
});

describe("canDropInto", () => {
  it("never drops a folder into itself", () => {
    expect(canDropInto("move", 5, [5, 6], [0])).toBe(false);
    expect(canDropInto("copy", 5, [5], [0])).toBe(false);
  });

  it("skips moving into the folder they're already in, but copies there", () => {
    expect(canDropInto("move", 0, [5], [0])).toBe(false);
    expect(canDropInto("copy", 0, [5], [0])).toBe(true);
    expect(canDropInto("move", 9, [5], [0])).toBe(true);
  });

  it("moves search results from different folders into one of them", () => {
    expect(canDropInto("move", 3, [5, 6], [3, 4])).toBe(true);
  });
});

describe("renaming", () => {
  it("selects the name without its extension", () => {
    expect(renameSelection("Movie.2024.1080p.mkv", false)).toEqual([0, 16]);
    expect(renameSelection("Season.2.Pack", true)).toEqual([0, 13]);
    expect(renameSelection(".hidden", false)).toEqual([0, 7]);
    expect(renameSelection("Severance.S02.1080p.WEB-SuccessfulCrab", false)).toEqual([0, 38]);
  });

  it("ignores blank and unchanged names", () => {
    expect(cleanName("  New name ", "Old")).toBe("New name");
    expect(cleanName("   ", "Old")).toBeUndefined();
    expect(cleanName("Old ", "Old")).toBeUndefined();
  });
});

describe("idsToForget", () => {
  it("drops deleted videos and the videos inside deleted folders", () => {
    const entries = [{ id: 10, parentID: 1 }, { id: 11, parentID: 2 }, { id: 12 }, { id: 3, parentID: 1 }];
    expect(idsToForget([1, 3], entries)).toEqual([1, 3, 10]);
  });
});
