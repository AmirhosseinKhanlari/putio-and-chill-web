import { describe, expect, it } from "vitest";
import { PutioError, type PutioAccount, type PutioFile, type PutioTrash, type PutioTrashFile } from "../api/putio";
import { requiredSpace } from "./makeRoom";
import { deleteForRoom, neededFor, offerExplanation, offerMessage, planFor, purgeForRoom, readRoomFolders, type RoomOffer } from "./makeRoomRun";
import { entries, folders, rules } from "./makeRoom.fixture";

/** put.io whose free space follows what's in it: `size` minus every file, and (with `trashCounts`) the Trash too. */
class SpacePutio {
  files = new Map<number, PutioFile>();
  trashed: PutioTrashFile[] = [];
  size = 30_000;
  trashCounts = false;
  deleteCalls: number[][] = [];
  trashDeleteCalls: number[][] = [];

  constructor() {
    for (const f of folders) this.files.set(f.id, f);
    for (const e of entries) this.files.set(e.id, { id: e.id, name: e.name, file_type: "VIDEO", size: e.size, parent_id: e.parentID, created_at: e.createdAt });
  }
  children(id: number) { return [...this.files.values()].filter((f) => (f.parent_id ?? 0) === id); }
  private reachable(id: number): PutioFile[] { return this.children(id).flatMap((f) => [f, ...(f.file_type === "FOLDER" ? this.reachable(f.id) : [])]); }
  get used() {
    const files = this.reachable(0).filter((f) => f.file_type !== "FOLDER").reduce((s, f) => s + (f.size ?? 0), 0);
    return files + (this.trashCounts ? this.trashed.reduce((s, f) => s + (f.size ?? 0), 0) : 0);
  }
  async account(): Promise<PutioAccount> { return { username: "me", disk: { avail: this.size - this.used, size: this.size, used: this.used } }; }
  async list(id: number) {
    if (id !== 0 && !this.reachable(0).some((f) => f.id === id)) throw new PutioError(404, "gone");
    return { files: this.children(id) };
  }
  async deleteFiles(ids: number[]) {
    this.deleteCalls.push(ids);
    for (const id of ids) {
      const f = this.files.get(id)!;
      this.trashed.push({ id, name: f.name, file_type: f.file_type, size: f.size });
      this.files.set(id, { ...f, parent_id: -1 });
    }
  }
  async trash(): Promise<PutioTrash> { return { files: this.trashed }; }
  async deleteFromTrash(ids: number[]) {
    this.trashDeleteCalls.push(ids);
    this.trashed = this.trashed.filter((f) => !ids.includes(f.id));
  }
  async emptyTrash() { throw new Error("the whole Trash must never be emptied"); }
}

async function rig(sizeOver: number) {
  const putio = new SpacePutio();
  const avail = (await putio.account()).disk!.avail;
  const size = avail + sizeOver;
  const plan = await planFor(putio, requiredSpace(size) - avail, {
    entries, isWatched: (id) => rules.watched.has(id), resumeSeconds: (e) => rules.positions.get(e.id) ?? 0,
    myList: [{ tmdbID: 4, kind: "movie", title: "Movie 4" }],
  });
  return { putio, avail, size, required: requiredSpace(size), plan };
}

describe("making room", () => {
  it("reads Movies and TV Series fresh, and nothing else", async () => {
    const found = await readRoomFolders(new SpacePutio());
    expect(found.map((f) => f.id).sort((a, b) => a - b)).toEqual([10, 11, 13, 14, 15, 20, 21, 22, 23]);
  });

  it("plans from the library with My List and positions", async () => {
    const { plan } = await rig(5000);
    expect(plan.candidates.map((c) => c.id)).toEqual([22, 23, 11, 211, 212, 151, 152, 12]);
    expect(plan.suggested).toEqual([22]);
  });

  it("deletes only the confirmed items, then is ready", async () => {
    const { putio, plan, required } = await rig(5000);
    const step = await deleteForRoom(putio, plan, new Set([23, 11, 999, 13]), required, "Dune");
    expect(putio.deleteCalls).toEqual([[23, 11]]);
    expect(step).toMatchObject({ kind: "ready", freed: 6600, deletedIDs: [23, 11] });
    expect(step.forgotten.sort()).toEqual([111, 231]);
    expect(putio.trashDeleteCalls).toEqual([]);
  });

  it("asks before removing deleted items from the Trash, and removes only those", async () => {
    const { putio, plan, required } = await rig(2000);
    putio.trashCounts = true;
    await putio.deleteFiles([301]);
    putio.deleteCalls = [];
    const step = await deleteForRoom(putio, plan, new Set(plan.suggested), required, "Dune");
    expect(putio.deleteCalls).toEqual([[22]]);
    expect(step.kind).toBe("trash");
    if (step.kind !== "trash") return;
    expect(step.items.map((i) => i.id)).toEqual([22]);
    const after = await purgeForRoom(putio, step, required, "Dune");
    expect(putio.trashDeleteCalls).toEqual([[22]]);
    expect(putio.trashed.map((f) => f.id)).toEqual([301]);
    expect(after.kind).toBe("ready");
  });

  it("says so and sends nothing when put.io still shows too little after the Trash", async () => {
    const { putio, plan, required } = await rig(100);
    putio.size -= 6000;
    const step = await deleteForRoom(putio, plan, new Set(plan.suggested), required, "Dune");
    expect(step.kind).toBe("trash");
    if (step.kind !== "trash") return;
    const after = await purgeForRoom(putio, step, required, "Dune");
    expect(after.kind).toBe("failed");
    if (after.kind === "failed") expect(after.message).toContain("still shows only");
  });

  it("deletes nothing when a folder got new videos since the library was read", async () => {
    const { putio, plan, required } = await rig(100);
    putio.files.set(223, { id: 223, name: "S01E03.mkv", file_type: "VIDEO", size: 3000, parent_id: 22 });
    putio.size += 3000;
    const step = await deleteForRoom(putio, plan, new Set(plan.suggested), required, "Dune");
    expect(putio.deleteCalls).toEqual([]);
    expect(step).toMatchObject({ kind: "failed" });
    if (step.kind === "failed") expect(step.message).toContain("Nothing was deleted");
  });

  it("explains plainly when nothing can be done", async () => {
    const { plan } = await rig(1_000_000);
    const offer: RoomOffer = { title: "Dune", size: 2_000_000, avail: 1000, plan };
    expect(plan.suggested).toEqual([]);
    expect(offerExplanation(offer)).toContain("would free only");
    expect(offerExplanation({ ...offer, plan: undefined })).toContain("Settings");
    expect(offerMessage({ title: "Severance · Season 2", size: 7_400_000_000, avail: 2_100_000_000 })).toBe("Severance · Season 2 needs 7.4 GB, you have 2.1 GB free.");
    expect(neededFor({ size: 1000, avail: 1000 })).toBe(20);
  });
});
