import { describe, expect, it } from "vitest";
import { deviceSave, mergePosition, putioRead, type Position } from "./positions";
import { creditsLength, markAfter, reachedWatched, watchedThreshold } from "./watched";

describe("when a video counts as watched (95%, or the credits if they start first)", () => {
  it("a 5-minute video: the credits (20 s) start before 95%", () => {
    expect(creditsLength(300)).toBe(20);
    expect(watchedThreshold(300)).toBe(280);
    expect(reachedWatched(279, 300)).toBe(false);
    expect(reachedWatched(280, 300)).toBe(true);
  });

  it("a 22-minute episode: 95% comes before the credits (33 s)", () => {
    expect(creditsLength(1320)).toBe(33);
    expect(watchedThreshold(1320)).toBe(1254);
    expect(reachedWatched(1253, 1320)).toBe(false);
    expect(reachedWatched(1254, 1320)).toBe(true);
  });

  it("a 2-hour movie: 95%, long before the last minute", () => {
    expect(creditsLength(7200)).toBe(60);
    expect(watchedThreshold(7200)).toBe(6840);
  });

  it("never without a length", () => {
    expect(reachedWatched(5000, undefined)).toBe(false);
    expect(reachedWatched(5000, 0)).toBe(false);
    expect(reachedWatched(5000, Number.NaN)).toBe(false);
  });
});

describe("markAfter (newest wins with positions)", () => {
  const synced = (seconds: number, at: number): Position => ({ seconds, at, source: "device", watchedAt: at, pending: false });
  const after = (mark: number | undefined, previous: Position | undefined, incoming: Position) =>
    markAfter(mark, previous, mergePosition(previous, incoming), incoming);

  it("a rewatch saved here (started) takes the mark away; a few seconds in doesn't", () => {
    expect(after(100, synced(0, 100), deviceSave(600, 200))).toBeUndefined();
    expect(after(100, synced(0, 100), deviceSave(12, 200))).toBe(100);
  });

  it("put.io's 0 read after the mark keeps it watched", () => {
    expect(after(100, synced(0, 100), putioRead(0, 200))).toBe(100);
  });

  it("a later started position from put.io (a rewatch elsewhere) takes it away; an older read doesn't", () => {
    expect(after(100, synced(0, 100), putioRead(900, 200, 200))).toBeUndefined();
    expect(after(100, synced(0, 100), putioRead(900, 50, 50))).toBe(100);
  });

  it("a reset put.io hasn't got yet isn't undone by its old position", () => {
    expect(after(100, deviceSave(0, 100), putioRead(1250, 200))).toBe(100);
  });

  it("put.io's 0 replacing an older started position: finished elsewhere, watched at the read", () => {
    expect(after(undefined, synced(1250, 100), putioRead(0, 200))).toBe(200);
    // Not when ours is newer, or still on its way to put.io.
    expect(after(undefined, synced(1250, 300), putioRead(0, 200))).toBeUndefined();
    expect(after(undefined, deviceSave(1250, 100), putioRead(0, 200))).toBeUndefined();
    // Nor when what it replaces was barely started.
    expect(after(undefined, synced(10, 100), putioRead(0, 200))).toBeUndefined();
  });
});
