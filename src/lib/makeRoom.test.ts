import { describe, expect, it } from "vitest";
import { availableToFree, candidateDetail, chosen, freedBy, isOutOfSpace, planRoom, requiredSpace, roomCandidates, shortfall, type RoomRules } from "./makeRoom";
import { entries, folder, folders, rules } from "./makeRoom.fixture";

const ids = (r: RoomRules = rules, e = entries, f = folders) => roomCandidates(e, f, r).map((c) => c.id);

describe("fit check", () => {
  it("adds 2%", () => {
    expect(requiredSpace(1000)).toBe(1020);
    expect(shortfall(1000, 1020)).toBeUndefined();
    expect(shortfall(1000, 1019)).toBe(1);
    expect(shortfall(7_400_000_000, 2_100_000_000)).toBe(7_548_000_000 - 2_100_000_000);
  });
  it("never checks an unknown size or free space", () => {
    expect(shortfall(undefined, 10)).toBeUndefined();
    expect(shortfall(0, 10)).toBeUndefined();
    expect(shortfall(1000, undefined)).toBeUndefined();
  });
  it("recognises put.io's out-of-space errors leniently", () => {
    for (const m of ["Not enough disk space", "There is not enough space in your account.", "Insufficient storage", "No space left on device",
      "Your disk is full", "Disk quota exceeded", "Storage full", "out of space", "The download exceeds your available storage"]) {
      expect(isOutOfSpace(m), m).toBe(true);
    }
    for (const m of [undefined, null, "", "Tracker error", "No peers", "Invalid torrent", "Transfer limit reached", "Space Jam.mkv not found"]) {
      expect(isOutOfSpace(m), String(m)).toBe(false);
    }
  });
});

describe("what can go", () => {
  it("goes watched first, then unwatched, oldest added first", () => {
    expect(ids()).toEqual([22, 23, 11, 211, 212, 151, 152, 12]);
  });

  it("keeps what's being watched, on My List, and outside Movies and TV Series", () => {
    const all = new Set(roomCandidates(entries, folders, rules).flatMap((c) => [c.id, ...c.fileIDs]));
    for (const id of [13, 131, 14, 141, 30, 301, 5, 10, 20, 21]) expect(all.has(id), String(id)).toBe(false);
  });

  it("counts a video as being watched from 30 s, unless it was watched to the end", () => {
    expect(ids({ ...rules, positions: new Map([[131, 29]]) })).toContain(13);
    expect(ids({ ...rules, positions: new Map([[131, 30]]) })).not.toContain(13);
    expect(ids({ ...rules, positions: new Map([[131, 30]]), watched: new Set([...rules.watched, 131]) })).toContain(13);
  });

  it("takes season folders whole and loose episodes alone", () => {
    const list = roomCandidates(entries, folders, rules);
    const season1 = list.find((c) => c.id === 22)!;
    expect(season1).toMatchObject({ isFolder: true, kind: "season", season: 1, size: 6000, watched: true });
    expect(season1.fileIDs.sort()).toEqual([221, 222]);
    expect(candidateDetail(season1)).toBe("Season 1");
    const ep = list.find((c) => c.id === 211)!;
    expect(ep).toMatchObject({ isFolder: false, kind: "episode", watched: false });
    expect(candidateDetail(ep)).toBe("S3 E1");
    expect(list.find((c) => c.id === 11)).toMatchObject({ kind: "movie", size: 4100 });
    expect(list.find((c) => c.id === 12)?.isFolder).toBe(false);
    expect(list.some((c) => c.id === 15)).toBe(false);
  });

  it("never takes a folder whole that holds an unknown folder or one a download saves into", () => {
    const s1 = entries.filter((e) => e.match?.season === 1);
    const without2 = folders.filter((f) => f.id !== 23);
    expect(ids(rules, s1, without2)).toEqual([21]);
    expect(ids(rules, s1, [...without2, folder(24, "Season 3", 21)])).toEqual([22]);
    expect(ids({ ...rules, busyFolders: new Set([21]) }, s1, without2)).toEqual([22]);
    expect(ids(rules, s1, [...without2, folder(25, "Subs", 22)])).toEqual([21]);
  });

  it("keeps the season being got, but not the show's other seasons", () => {
    expect(ids({ ...rules, target: { tmdbID: 100, kind: "tv", season: 3 } })).toEqual([22, 23, 11, 151, 152, 12]);
    expect(ids({ ...rules, target: { tmdbID: 100, kind: "tv" } })).toEqual([11, 151, 152, 12]);
    expect(ids({ ...rules, target: { tmdbID: 1, kind: "movie" } })).not.toContain(11);
  });

  it("suggests the fewest from the front", () => {
    const plan = planRoom(7000, entries, folders, rules);
    expect(plan.suggested).toEqual([22, 23]);
    expect(freedBy(plan, new Set(plan.suggested))).toBe(8500);
    expect(planRoom(1, entries, folders, rules).suggested).toEqual([22]);
    expect(freedBy(plan, new Set([23, 999, 13]))).toBe(2500);
    expect(chosen(plan, new Set([12, 22])).map((c) => c.id)).toEqual([22, 12]);
  });

  it("suggests nothing when even everything isn't enough", () => {
    const plan = planRoom(1_000_000, entries, folders, rules);
    expect(plan.suggested).toEqual([]);
    expect(availableToFree(plan)).toBe(6000 + 2500 + 4100 + 1000 + 1000 + 1000 + 1000 + 1500);
  });

  it("leaves out unknown sizes; a folder without one counts its videos", () => {
    expect(ids(rules, entries.map((e) => (e.id === 12 ? { ...e, size: undefined } : e)))).not.toContain(12);
    const sizeless = folders.map((f) => (f.id === 11 ? { ...f, size: undefined } : f));
    expect(roomCandidates(entries, sizeless, rules).find((c) => c.id === 11)?.size).toBe(4000);
  });
});
