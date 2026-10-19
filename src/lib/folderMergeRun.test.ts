import { beforeEach, describe, expect, it } from "vitest";
import { PutioError, type PutioAccount, type PutioFile, type PutioTransfer } from "../api/putio";
import { mergeMessage, runOldFolderMerge } from "./folderMergeRun";
import { mergeOldFoldersOnce } from "../state/oldFolderMerge";
import { loadSettings, updateSettings } from "./settings";

/** An in-memory put.io: folders by id, moves, renames, deletes (to a trash list), and failures on request. */
class FakePutio {
  files = new Map<number, PutioFile>();
  deletedFolders = new Set<number>();
  trashed: number[] = [];
  created: string[] = [];
  moves = 0;
  renames = 0;
  failingMoves = new Set<number>();
  failingRenames = new Set<number>();
  transfersList: PutioTransfer[] = [];
  afterMove?: () => void;
  private next = 10_000;

  constructor(files: PutioFile[]) {
    for (const f of files) this.files.set(f.id, f);
  }

  add(file: PutioFile) { this.files.set(file.id, file); }
  children(id: number) { return [...this.files.values()].filter((f) => (f.parent_id ?? 0) === id); }
  names(id: number) { return this.children(id).map((f) => f.name).sort(); }
  /** Every file (not folder) still in the account. */
  allFiles() { return new Set([...this.files.values()].filter((f) => f.file_type !== "FOLDER").map((f) => f.id)); }
  everything(id: number): PutioFile[] { return this.children(id).flatMap((f) => [f, ...(f.file_type === "FOLDER" ? this.everything(f.id) : [])]); }

  async account(): Promise<PutioAccount> { return { username: "Me", user_id: 42 }; }
  async list(id: number) {
    if (this.deletedFolders.has(id)) throw new PutioError(404, "not found");
    return { files: this.children(id) };
  }
  async createFolder(name: string, parent: number) {
    this.created.push(name);
    const folder = { id: this.next++, name, file_type: "FOLDER", parent_id: parent };
    this.add(folder);
    return folder;
  }
  async moveFiles(ids: number[], parent: number) {
    if (ids.some((id) => this.failingMoves.has(id))) throw new PutioError(500, "nope");
    this.moves++;
    for (const id of ids) {
      const f = this.files.get(id);
      if (f) this.files.set(id, { ...f, parent_id: parent });
    }
    this.afterMove?.();
  }
  async rename(id: number, name: string) {
    if (this.failingRenames.has(id)) throw new PutioError(500, "nope");
    this.renames++;
    const f = this.files.get(id);
    if (f) this.files.set(id, { ...f, name });
  }
  async deleteFiles(ids: number[]) {
    for (const id of ids) {
      const f = this.files.get(id);
      if (!f) continue;
      // put.io deletes a folder with everything in it: the merge must only ever delete empty ones.
      for (const inner of this.everything(id)) this.files.delete(inner.id);
      if (f.file_type === "FOLDER") this.deletedFolders.add(id);
      this.files.delete(id);
      this.trashed.push(id);
    }
  }
  async transfers() { return this.transfersList; }
}

const folder = (id: number, name: string, parent: number): PutioFile => ({ id, name, file_type: "FOLDER", parent_id: parent });
const video = (id: number, name: string, parent: number): PutioFile => ({ id, name, file_type: "VIDEO", parent_id: parent });

/** AMDB { Movies { Dune folder, Heat, Arrival }, TV { Severance/Season 2/E04, Andor/Season 1/E01 }, Music }, plus the
 * user's own "movies" (another Heat) and "tv series" (Severance/Season 2/E01), and Downloads. */
function world() {
  return new FakePutio([
    folder(1, "AMDB", 0),
    folder(2, "Movies", 1), folder(21, "Dune.Part.Two.2024.1080p", 2), video(211, "Dune.Part.Two.2024.1080p.mkv", 21),
    video(22, "Heat.1995.mkv", 2), video(23, "Arrival.2016.mkv", 2),
    folder(3, "TV", 1), folder(31, "Severance", 3), folder(311, "Season 2", 31), video(3111, "Severance.S02E04.mkv", 311),
    folder(32, "Andor", 3), folder(321, "Season 1", 32), video(3211, "Andor.S01E01.mkv", 321),
    folder(4, "Music", 1), { id: 41, name: "song.mp3", file_type: "AUDIO", parent_id: 4 },
    folder(5, "movies", 0), video(51, "Heat.1995.mkv", 5),
    folder(6, "tv series", 0), folder(61, "Severance", 6), folder(611, "Season 2", 61), video(6111, "Severance.S02E01.mkv", 611),
    folder(7, "Downloads", 0), video(71, "Other.mkv", 7),
  ]);
}

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

describe("runOldFolderMerge", () => {
  it("merges into the user's own folders, then has nothing left to do", async () => {
    const putio = world();
    const before = putio.allFiles();
    const report = await runOldFolderMerge(putio);
    expect(report).toMatchObject({ movies: 3, shows: 2, renamed: 1, leftInAMDB: ["Music"], finished: true, couldNotMove: false, oldFolderIDs: [2, 3] });
    expect(mergeMessage(report)).toBe("Moved 3 movies and 2 shows from AMDB into Movies and TV Series. One had the same name as something already there, so it now ends in “(from AMDB)”.");
    expect(putio.created).toEqual([]);
    expect(putio.names(5)).toEqual(["Arrival.2016.mkv", "Dune.Part.Two.2024.1080p", "Heat.1995 (from AMDB).mkv", "Heat.1995.mkv"]);
    expect(putio.names(6)).toEqual(["Andor", "Severance"]);
    expect(putio.names(611)).toEqual(["Severance.S02E01.mkv", "Severance.S02E04.mkv"]);
    expect(putio.names(1)).toEqual(["Music"]);
    expect(putio.names(7)).toEqual(["Other.mkv"]);
    expect(new Set(putio.trashed)).toEqual(new Set([2, 3, 31, 311]));
    expect(putio.allFiles()).toEqual(before);

    const calls = [putio.moves, putio.renames, putio.trashed.length, putio.created.length];
    const again = await runOldFolderMerge(putio);
    expect(again).toMatchObject({ finished: true, changedPutio: false });
    expect(mergeMessage(again)).toBeUndefined();
    expect([putio.moves, putio.renames, putio.trashed.length, putio.created.length]).toEqual(calls);
  });

  it("creates a missing Movies folder and removes AMDB once it's empty", async () => {
    const putio = new FakePutio([folder(1, "AMDB", 0), folder(2, "Movies", 1), video(21, "Heat.1995.mkv", 2)]);
    const report = await runOldFolderMerge(putio);
    expect(putio.created).toEqual(["Movies"]);
    expect(mergeMessage(report)).toBe("Moved 1 movie from AMDB into Movies.");
    expect(putio.trashed).toEqual([2, 1]);
    expect(putio.names(0)).toEqual(["Movies"]);
    expect(report.finished).toBe(true);
  });

  it("is a no-op without AMDB", async () => {
    const putio = new FakePutio([folder(7, "Downloads", 0)]);
    const report = await runOldFolderMerge(putio);
    expect(report.finished).toBe(true);
    expect([putio.moves, putio.trashed.length, putio.created.length]).toEqual([0, 0, 0]);
  });

  it("stops at a failed move, keeps what moved, and finishes next time", async () => {
    const putio = world();
    const before = putio.allFiles();
    putio.failingMoves.add(32);
    const first = await runOldFolderMerge(putio);
    expect(first).toMatchObject({ couldNotMove: true, finished: false, movies: 3, shows: 0 });
    expect(mergeMessage(first)).toMatch(/Some things in AMDB couldn't be moved yet\. The app will try again next time\.$/);
    expect(putio.trashed).not.toContain(3);
    expect(putio.allFiles()).toEqual(before);

    putio.failingMoves.clear();
    const second = await runOldFolderMerge(putio);
    expect(second).toMatchObject({ couldNotMove: false, finished: true, movies: 0, shows: 2 });
    expect(putio.names(6)).toEqual(["Andor", "Severance"]);
    expect(putio.allFiles()).toEqual(before);
  });

  it("stops at a failed rename before moving anything past it", async () => {
    const putio = world();
    putio.failingRenames.add(22);
    const report = await runOldFolderMerge(putio);
    expect(report.couldNotMove).toBe(true);
    expect(putio.names(2)).toEqual(["Arrival.2016.mkv", "Dune.Part.Two.2024.1080p", "Heat.1995.mkv"]);
    expect(putio.names(5)).toEqual(["Heat.1995.mkv"]);
  });

  it("keeps a folder that filled up meanwhile, and one a running transfer saves into", async () => {
    const putio = world();
    let landed = false;
    putio.afterMove = () => {
      if (landed) return;
      landed = true;
      putio.add(video(9999, "Severance.S02E05.mkv", 311));
    };
    const report = await runOldFolderMerge(putio);
    expect(putio.trashed).not.toContain(311);
    expect(report.finished).toBe(false);
    putio.afterMove = undefined;
    expect((await runOldFolderMerge(putio)).finished).toBe(true);
    expect(putio.names(611)).toEqual(["Severance.S02E01.mkv", "Severance.S02E04.mkv", "Severance.S02E05.mkv"]);

    const busy = world();
    busy.transfersList = [{ id: 1, status: "DOWNLOADING", save_parent_id: 311 }];
    expect((await runOldFolderMerge(busy)).finished).toBe(false);
    expect(busy.trashed).not.toContain(311);
    busy.transfersList = [{ id: 1, status: "COMPLETED", save_parent_id: 311 }];
    expect((await runOldFolderMerge(busy)).finished).toBe(true);
    expect(busy.trashed).toContain(311);
  });

  it("loses nothing when two run at once", async () => {
    const putio = world();
    const before = putio.allFiles();
    await Promise.all([runOldFolderMerge(putio), runOldFolderMerge(putio)]);
    expect((await runOldFolderMerge(putio)).finished).toBe(true);
    expect(putio.allFiles()).toEqual(before);
    const merged = new Set([...putio.everything(5), ...putio.everything(6)].map((f) => f.id));
    for (const id of [211, 22, 23, 51, 3111, 3211, 6111]) expect(merged.has(id)).toBe(true);
  });
});

describe("mergeOldFoldersOnce", () => {
  it("runs once per account, refreshes the library, and resets a Settings pick of an old folder", async () => {
    const putio = world();
    updateSettings({ tvFolder: { id: 3, path: "Media/Renamed TV" } });
    let refreshes = 0;
    const refresh = async () => { refreshes++; };
    const result = await mergeOldFoldersOnce(putio, refresh);
    expect(result?.report.shows).toBe(2);
    expect(result?.message).toMatch(/^Moved 3 movies and 2 shows/);
    expect(refreshes).toBe(1);
    expect(loadSettings().tvFolder).toBeNull();
    expect(localStorage.getItem("pc.oldFoldersMerged.42")).toBe("1");
    expect(await mergeOldFoldersOnce(putio, refresh)).toBeUndefined();
    expect(refreshes).toBe(1);
  });

  it("isn't done until it finishes, and never runs twice at once", async () => {
    const putio = world();
    putio.failingMoves.add(32);
    const refresh = async () => {};
    const [first, overlapping] = await Promise.all([mergeOldFoldersOnce(putio, refresh), mergeOldFoldersOnce(putio, refresh)]);
    expect(first?.report.couldNotMove).toBe(true);
    expect(overlapping).toBeUndefined();
    putio.failingMoves.clear();
    expect((await mergeOldFoldersOnce(putio, refresh))?.report.finished).toBe(true);
    expect(await mergeOldFoldersOnce(putio, refresh)).toBeUndefined();
  });
});
