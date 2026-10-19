import { describe, expect, it } from "vitest";
import { deviceSave, mergePosition, putioRead, type Position } from "./positions";

describe("mergePosition (newest wins, as in the native apps)", () => {
  const synced = (seconds: number, at: number, watchedAt?: number): Position => ({ seconds, at, source: "device", watchedAt, pending: false });

  it("takes anything when there's nothing yet", () => {
    expect(mergePosition(undefined, putioRead(600, 10))).toEqual(putioRead(600, 10));
  });

  it("a save here always wins, and counts as watched then", () => {
    expect(mergePosition(putioRead(900, 50, 50), deviceSave(300, 20))).toEqual({ seconds: 300, at: 20, source: "device", watchedAt: 20, pending: true });
  });

  it("put.io giving back the same value confirms ours", () => {
    expect(mergePosition(deviceSave(300, 20), putioRead(300, 30, 30))).toEqual({ seconds: 300, at: 30, source: "device", watchedAt: 20, pending: false });
    expect(mergePosition(synced(300, 40, 40), putioRead(300, 30))).toMatchObject({ at: 40, watchedAt: 40 });
  });

  it("a pending save beats an older value read from put.io, even one read later", () => {
    expect(mergePosition(deviceSave(300, 20), putioRead(100, 30, 30))).toEqual(deviceSave(300, 20));
  });

  it("a save made after the read began beats it", () => {
    expect(mergePosition(synced(300, 30, 30), putioRead(100, 20, 20))).toEqual(synced(300, 30, 30));
  });

  it("a put.io read after a synced save replaces it, keeping the latest watched time", () => {
    expect(mergePosition(synced(300, 20, 20), putioRead(1200, 30, 30))).toEqual(putioRead(1200, 30, 30));
    expect(mergePosition(synced(300, 20, 20), putioRead(1200, 30))).toEqual(putioRead(1200, 30, 20));
  });

  it("finished elsewhere (0) replaces a synced position", () => {
    expect(mergePosition(synced(300, 20, 20), putioRead(0, 30))).toMatchObject({ seconds: 0, source: "putio" });
  });
});
