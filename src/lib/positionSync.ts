/** Keeps watch positions in step with put.io without reading the whole library: saves go out (and wait, pending,
 * when put.io can't be reached), and positions from other devices are read when the app comes to the front. */
import { PutioError, type PutioClient } from "../api/putio";
import { library, type LibraryIndex } from "./library";

type StartFromClient = Pick<PutioClient, "getStartFrom" | "setStartFrom" | "resetStartFrom">;

/** At most one check this often (the app start, focus and Home can all ask at once). */
const CHECK_EVERY_MS = 30_000;
const CHECK_TIMEOUT_MS = 4000;
const CHECK_PARALLEL = 6;
/** The player's own read waits less: playback shouldn't hang on put.io. */
export const PLAYER_TIMEOUT_MS = 2000;
/** Watched this far counts as finished: put.io forgets the position. */
const FINISHED = 0.95;

/** `run` gets a signal that aborts when `ms` passes; the promise then rejects. */
function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("timed out")); }, ms);
  });
  return Promise.race([run(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

export class PositionSync {
  private lastCheck = 0;
  /** Sends per file, one after another, so an older value never lands after a newer one. */
  private sending = new Map<number, Promise<void>>();

  constructor(private readonly lib: LibraryIndex, private readonly retryDelayMs = 1000) {}

  /** The player's position: kept here at once, then sent with anything else still waiting. */
  save(putio: StartFromClient, fileID: number, position: number, duration?: number): Promise<void> {
    const finished = duration !== undefined && duration > 0 && position >= duration * FINISHED;
    this.lib.noteProgress(fileID, finished ? 0 : position, duration);
    return this.sendPending(putio);
  }

  sendPending(putio: StartFromClient): Promise<void> {
    return Promise.all(this.lib.pendingPositions().map((id) => this.send(putio, id))).then(() => {});
  }

  /** Sends saves still waiting, then (at most every 30 s) reads put.io's positions for the files most likely to
   * have moved on another device. A file that fails or takes too long is skipped until the next check. */
  async check(putio: StartFromClient): Promise<void> {
    const due = Date.now() - this.lastCheck >= CHECK_EVERY_MS;
    if (due) this.lastCheck = Date.now();
    await this.sendPending(putio);
    if (!due) return;
    const ids = this.lib.positionCandidates();
    let next = 0;
    const worker = async () => {
      while (next < ids.length) await this.fetch(putio, ids[next++], CHECK_TIMEOUT_MS).catch(() => {});
    };
    await Promise.all(Array.from({ length: CHECK_PARALLEL }, worker));
  }

  /** put.io's position for one file, merged in (newest wins). Rejects when it can't be read in time. */
  async fetch(putio: StartFromClient, fileID: number, timeoutMs: number): Promise<void> {
    const readAt = Date.now();
    const seconds = await withTimeout(timeoutMs, (signal) => putio.getStartFrom(fileID, signal));
    this.lib.notePutioPosition(fileID, seconds, readAt);
  }

  private send(putio: StartFromClient, fileID: number): Promise<void> {
    const queued = (this.sending.get(fileID) ?? Promise.resolve()).then(() => this.deliver(putio, fileID));
    this.sending.set(fileID, queued);
    void queued.finally(() => { if (this.sending.get(fileID) === queued) this.sending.delete(fileID); });
    return queued;
  }

  /** Tries twice, a second apart; a save that still fails stays pending for the next chance. */
  private async deliver(putio: StartFromClient, fileID: number): Promise<void> {
    const position = this.lib.position(fileID);
    if (!position?.pending) return;
    const put = () => (position.seconds > 0 ? putio.setStartFrom(fileID, position.seconds) : putio.resetStartFrom(fileID));
    try {
      await put().catch(async (error) => {
        if (error instanceof PutioError && error.status === 404) return; // The file is gone: nothing to keep.
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
        await put();
      });
    } catch {
      return;
    }
    this.lib.markSent(fileID, position.at);
  }
}

export const positionSync = new PositionSync(library);
