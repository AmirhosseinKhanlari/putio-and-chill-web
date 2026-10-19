import { describe, expect, it } from "vitest";
import type { PutioFile } from "../api/putio";
import { freeName, node, planMerge, planOldFolders, type PutioNode } from "./folderMerge";

const folder = (id: number, name: string, children: PutioNode[] = []) => node({ id, name, file_type: "FOLDER" }, children);
const video = (id: number, name: string) => node({ id, name, file_type: "VIDEO" });
const text = (id: number, name: string) => node({ id, name, file_type: "TEXT" } satisfies PutioFile);

describe("planMerge", () => {
  it("only deletes an empty source", () => {
    expect(planMerge(folder(1, "Movies"), folder(2, "Movies")).steps).toEqual([{ kind: "deleteIfEmpty", id: 1, name: "Movies" }]);
  });

  it("moves items in one batch", () => {
    const source = folder(1, "Movies", [folder(11, "Dune.Part.Two.2024.1080p"), video(12, "Heat.1995.mkv"), folder(13, "Arrival (2016)")]);
    const plan = planMerge(source, folder(2, "Movies", [folder(21, "Past Lives")]));
    expect(plan.steps).toEqual([
      { kind: "move", ids: [13, 11, 12], from: 1, into: 2 },
      { kind: "deleteIfEmpty", id: 1, name: "Movies" },
    ]);
  });

  it("merges same-named shows and seasons, deleting emptied folders last, deepest first", () => {
    const source = folder(1, "TV", [
      folder(10, "Severance", [folder(11, "Season 2", [video(111, "Severance.S02E04.mkv")]), folder(12, "Season 3", [video(121, "Severance.S03E01.mkv")])]),
      folder(20, "Andor", [folder(21, "Season 1")]),
    ]);
    const target = folder(2, "TV Series", [folder(30, " severance", [folder(31, "season 2", [video(311, "Severance.S02E01.mkv")])])]);
    expect(planMerge(source, target).steps).toEqual([
      { kind: "move", ids: [20], from: 1, into: 2 },
      { kind: "move", ids: [12], from: 10, into: 30 },
      { kind: "move", ids: [111], from: 11, into: 31 },
      { kind: "deleteIfEmpty", id: 11, name: "Season 2" },
      { kind: "deleteIfEmpty", id: 10, name: "Severance" },
      { kind: "deleteIfEmpty", id: 1, name: "TV" },
    ]);
  });

  it("renames on a name clash instead of overwriting, and checks the new name too", () => {
    const source = folder(1, "Movies", [video(11, "Heat.1995.mkv"), folder(12, "Dune"), text(13, "notes"), video(14, "Heat.1995 (from AMDB 2).mkv")]);
    const target = folder(2, "Movies", [video(21, "heat.1995.MKV"), video(22, "Heat.1995 (from AMDB).mkv"), video(23, "Dune"), folder(24, "Notes")]);
    const plan = planMerge(source, target);
    expect(plan.steps.filter((s) => s.kind === "rename")).toEqual([
      { kind: "rename", id: 12, parentID: 1, name: "Dune (from AMDB)" },
      { kind: "rename", id: 11, parentID: 1, name: "Heat.1995 (from AMDB 3).mkv" },
      { kind: "rename", id: 13, parentID: 1, name: "notes (from AMDB)" },
    ]);
    const move = plan.steps.find((s) => s.kind === "move");
    expect(move?.kind === "move" && [...move.ids].sort()).toEqual([11, 12, 13, 14]);
    expect(plan.renamed).toBe(3);
    expect(plan.steps.findIndex((s) => s.kind === "move")).toBeGreaterThan(plan.steps.findIndex((s) => s.kind === "rename"));
  });

  it("keeps extensions when renaming", () => {
    const none = new Set<string>();
    expect(freeName(video(1, "Show.S02E04.1080p.mkv"), none)).toBe("Show.S02E04.1080p (from AMDB).mkv");
    expect(freeName(video(2, "Show.S02E04"), none)).toBe("Show.S02E04 (from AMDB)");
    expect(freeName(video(3, "Movie.2024"), none)).toBe("Movie.2024 (from AMDB)");
    expect(freeName(folder(4, "Release.1080p.WEB"), none)).toBe("Release.1080p.WEB (from AMDB)");
  });

  it("does nothing for what's already merged", () => {
    const moved = video(11, "Heat.1995.mkv");
    expect(planMerge(folder(1, "Movies", [moved]), folder(2, "Movies", [moved])).steps).toEqual([{ kind: "deleteIfEmpty", id: 1, name: "Movies" }]);
    const same = folder(1, "Movies", [moved]);
    expect(planMerge(same, same).steps).toEqual([]);
  });
});

describe("planOldFolders", () => {
  it("merges only AMDB's Movies and TV and leaves everything else (and AMDB) alone", () => {
    const old = folder(1, "AMDB", [
      folder(2, "movies", [folder(21, "Dune (2021)"), video(22, "Heat.mkv"), text(23, "notes.txt")]),
      folder(3, "TV", [folder(31, "Severance")]),
      folder(4, "Music", [text(41, "song.mp3")]),
      text(5, "readme.txt"),
    ]);
    const plan = planOldFolders(old, folder(100, "Movies"), folder(200, "TV Series"));
    expect(plan.leftAlone).toEqual(["Music", "readme.txt"]);
    expect(plan.movieIDs).toEqual([21, 22]);
    expect(plan.showIDs).toEqual([31]);
    expect(plan.steps).toEqual([
      { kind: "move", ids: [21, 22, 23], from: 2, into: 100 },
      { kind: "deleteIfEmpty", id: 2, name: "movies" },
      { kind: "move", ids: [31], from: 3, into: 200 },
      { kind: "deleteIfEmpty", id: 3, name: "TV" },
    ]);
  });

  it("deletes AMDB last, only when Movies and TV were all that was in it", () => {
    const plan = planOldFolders(folder(1, "AMDB", [folder(2, "Movies", [video(22, "Heat.mkv")])]), folder(100, "Movies"));
    expect(plan.steps.at(-1)).toEqual({ kind: "deleteIfEmpty", id: 1, name: "AMDB" });
    const partial = planOldFolders(folder(1, "AMDB", [folder(2, "Movies"), folder(3, "TV", [folder(31, "Severance")])]), folder(100, "Movies"));
    expect(partial.leftAlone).toEqual(["TV"]);
    expect(partial.steps).toEqual([{ kind: "deleteIfEmpty", id: 2, name: "Movies" }]);
  });

  it("has nothing to do without old folders", () => {
    const plan = planOldFolders(folder(1, "AMDB", [folder(4, "Music")]));
    expect(plan.steps).toEqual([]);
    expect(plan.leftAlone).toEqual(["Music"]);
  });
});
