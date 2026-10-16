/** Every torrent source at once (port of the iPhone app's ReleaseAggregator): the sources turned on in Settings are
 * asked in parallel, each with 12 seconds to answer; the same torrent from several sources becomes one row. */
import type { ChillClient } from "../chill";
import type { AppSettings } from "../../lib/settings";
import { apibay } from "./apibay";
import { eztv } from "./eztv";
import { knaben } from "./knaben";
import { torrentGalaxy } from "./torrentgalaxy";
import { torrentsCSV } from "./torrentscsv";
import { anySignal, SourceError, type Release, type ReleaseQuery, type SourceID, type SourceProvider } from "./types";
import { yts } from "./yts";

export type { Release, ReleaseQuery, SourceID, SourceProvider } from "./types";

const direct: Record<Exclude<SourceID, "chill">, SourceProvider> = { yts, eztv, apibay, knaben, torrentscsv: torrentsCSV, torrentgalaxy: torrentGalaxy };

export const sourceNames: Record<SourceID, string> = {
  chill: "chill.institute", yts: "YTS", eztv: "EZTV", apibay: "The Pirate Bay", knaben: "Knaben", torrentscsv: "Torrents.csv",
  torrentgalaxy: "TorrentGalaxy",
};

/** The sources to ask: those turned on, in Settings' order; chill.institute only when it's connected. */
export function enabledProviders(settings: Pick<AppSettings, "sources">, chill?: ChillClient): SourceProvider[] {
  return settings.sources.filter((s) => s.enabled).flatMap((s): SourceProvider[] => {
    if (s.id === "chill") return chill ? [chill] : [];
    return [direct[s.id]];
  });
}

export interface SourceFailure { source: SourceID; message: string }

export interface ReleaseSnapshot {
  releases: Release[];
  failures: SourceFailure[];
  /** Sources still searching. */
  pending: SourceID[];
}

/** Merge key: the info-hash when known, else name and size. */
export const releaseKey = (r: Release) => r.infoHash ?? `${r.name.toLowerCase()}|${r.sizeBytes ?? -1}`;

/** Adds `incoming` to `existing`, first-seen order. Duplicates keep the most seeders, every source tag, a size when
 * one of them knows it, and a magnet link over a chill link. */
export function mergeReleases(existing: Release[], incoming: Release[]): Release[] {
  const byKey = new Map<string, Release>();
  for (const row of [...existing, ...incoming]) {
    const key = releaseKey(row);
    const current = byKey.get(key);
    if (!current) { byKey.set(key, row); continue; }
    byKey.set(key, {
      ...current,
      sources: [...new Set([...current.sources, ...row.sources])],
      seeders: row.seeders === undefined ? current.seeders : Math.max(current.seeders ?? 0, row.seeders),
      sizeBytes: current.sizeBytes ?? row.sizeBytes,
      link: !current.link.startsWith("magnet:") && row.link.startsWith("magnet:") ? row.link : current.link,
    });
  }
  return [...byKey.values()];
}

export type ReleaseSort = "seeders" | "size" | "quality";

/** Most seeders (then quality), biggest, or best quality (then seeders); unknowns last. */
export function sortReleases(list: Release[], sort: ReleaseSort): Release[] {
  const seeds = (r: Release) => r.seeders ?? -1;
  const size = (r: Release) => r.sizeBytes ?? -1;
  return [...list].sort((a, b) => {
    switch (sort) {
      case "seeders": return seeds(b) - seeds(a) || b.parsed.resolution - a.parsed.resolution;
      case "size": return size(b) - size(a);
      case "quality": return b.parsed.resolution - a.parsed.resolution || seeds(b) - seeds(a);
    }
  });
}

const failureMessage = (id: SourceID, error: unknown) => {
  if (error instanceof SourceError) return `${sourceNames[id]} ${error.message}.`;
  if (error instanceof DOMException && error.name === "TimeoutError") return `${sourceNames[id]} didn't answer in time.`;
  return error instanceof Error && error.message ? error.message : `${sourceNames[id]} failed.`;
};

/** Asks every provider in parallel. `onUpdate` gets a snapshot after each one answers, so a list can fill in as
 * results arrive; the returned snapshot is the final one. */
export async function searchReleases(
  query: ReleaseQuery,
  providers: SourceProvider[],
  options: { timeoutMs?: number; signal?: AbortSignal; onUpdate?: (s: ReleaseSnapshot) => void } = {},
): Promise<ReleaseSnapshot> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  let snapshot: ReleaseSnapshot = { releases: [], failures: [], pending: providers.map((p) => p.id) };
  options.onUpdate?.(snapshot);
  await Promise.all(providers.map(async (provider) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? anySignal([options.signal, timeout]) : timeout;
    let rows: Release[] = [];
    let failure: SourceFailure | undefined;
    try {
      rows = await provider.releases(query, signal);
    } catch (error) {
      failure = { source: provider.id, message: failureMessage(provider.id, timeout.aborted ? new DOMException("", "TimeoutError") : error) };
    }
    if (options.signal?.aborted) return;
    snapshot = {
      releases: mergeReleases(snapshot.releases, rows),
      failures: failure ? [...snapshot.failures, failure] : snapshot.failures,
      pending: snapshot.pending.filter((id) => id !== provider.id),
    };
    options.onUpdate?.(snapshot);
  }));
  return snapshot;
}
