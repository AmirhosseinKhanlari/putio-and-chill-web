/** Get & Watch: picks the best release and sends it to put.io, into the same folders the iPhone app uses
 * (AMDB/Movies, AMDB/TV/<Show>/Season N). */
import type { Release } from "../api/chill";
import type { PutioClient, PutioTransfer } from "../api/putio";
import type { MediaKind } from "../api/tmdb";
import type { Resolution } from "./releaseName";
import { keys, readJSON, writeJSON } from "./storage";

export interface Settings {
  resolution: Exclude<Resolution, 0>;
}

export const defaultSettings: Settings = { resolution: 1080 };
export const loadSettings = (): Settings => ({ ...defaultSettings, ...readJSON<Partial<Settings>>(keys.settings, {}) });
export const saveSettings = (s: Settings) => writeJSON(keys.settings, s);

/** The preferred quality with the most seeders; else the closest lower one; else the closest higher one. Never a
 * camera recording, never a release nobody seeds (when others have seeders). */
export function pickRelease(releases: Release[], preferred: Settings["resolution"]): Release | undefined {
  const usable = releases.filter((r) => r.parsed.source !== "CAM");
  const seeded = usable.filter((r) => (r.seeders ?? 0) > 0);
  const pool = seeded.length ? seeded : usable;
  const rank = (r: Release) => {
    const res = r.parsed.resolution || 720;
    if (res === preferred) return 0;
    return res < preferred ? 1 + (preferred - res) / 10_000 : 2 + (res - preferred) / 10_000;
  };
  return [...pool].sort((a, b) => rank(a) - rank(b) || (b.seeders ?? 0) - (a.seeders ?? 0))[0];
}

export function folderPath(kind: MediaKind, title: string, season?: number): string[] {
  const safe = title.replace(/[/\\:]/g, " ").trim();
  if (kind === "movie") return ["AMDB", "Movies"];
  return season !== undefined ? ["AMDB", "TV", safe, `Season ${season}`] : ["AMDB", "TV", safe];
}

export interface PendingTransfer {
  transferID: number;
  tmdbID: number;
  kind: MediaKind;
  title: string;
  season?: number;
  episode?: number;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseName: string;
  addedAt: number;
}

const PENDING_KEY = "pc.transfers.v1";
export const pendingTransfers = (): PendingTransfer[] => readJSON<PendingTransfer[]>(PENDING_KEY, []);
export const savePendingTransfers = (list: PendingTransfer[]) => writeJSON(PENDING_KEY, list);

export async function sendToPutio(putio: PutioClient, release: Release, target: Omit<PendingTransfer, "transferID" | "releaseName" | "addedAt">): Promise<PutioTransfer> {
  const parent = await putio.ensurePath(folderPath(target.kind, target.title, target.season));
  const transfer = await putio.addTransfer(release.link, parent);
  savePendingTransfers([{ ...target, transferID: transfer.id, releaseName: release.name, addedAt: Date.now() }, ...pendingTransfers()].slice(0, 50));
  return transfer;
}
