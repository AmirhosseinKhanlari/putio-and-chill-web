/** Every torrent source at once (port of the iPhone app's ReleaseAggregator): the sources turned on in Settings are
 * asked in parallel, each with 12 seconds to answer; the same torrent from several sources becomes one row. Releases
 * that look fake never come out of it: names and sizes are checked as they arrive (lib/releaseSafety), releases
 * downloaded before and found fake are dropped, and once every source has answered the file lists of the top
 * releases are read (fileLists) before the search counts as finished. */
import type { ChillClient } from "../chill";
import { badReleases, isBlocked } from "../../lib/badReleases";
import { describeRejection, releaseRejection, type ReleaseRejection } from "../../lib/releaseSafety";
import type { AppSettings } from "../../lib/settings";
import { apibay } from "./apibay";
import { eztv } from "./eztv";
import { knaben } from "./knaben";
import { torrentGalaxy } from "./torrentgalaxy";
import { torrentsCSV } from "./torrentscsv";
import { fileListCandidates, fileRejections } from "./fileLists";
import { anySignal, releaseKey, SourceError, type Release, type ReleaseQuery, type SourceID, type SourceProvider } from "./types";
import { yts } from "./yts";

export type { Release, ReleaseQuery, SourceID, SourceProvider } from "./types";
export { releaseKey } from "./types";

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
  /** Every source answered and the file lists of the top releases are being read. */
  checkingFiles?: boolean;
  /** How many releases were left out because they look fake. */
  hidden?: number;
}

/** What was asked for, in words: its own words don't count as fake wording ("Crack" (2024)). */
const askedTitle = (query: ReleaseQuery) => (query.kind === "text" ? query.text : query.title);

function logRejection(name: string, reason: ReleaseRejection) {
  if (import.meta.env.DEV) console.debug(`[release-safety] hid ${name}: ${describeRejection(reason)}`);
}

/** The rows that don't look fake by name or size and weren't found fake before. */
export function screenReleases(rows: Release[], query: ReleaseQuery, blocked: Set<string>): Release[] {
  return rows.filter((row) => {
    const reason: ReleaseRejection | undefined = isBlocked(row, blocked) ? { kind: "knownBad" } : releaseRejection(row.name, row.sizeBytes, row.parsed, askedTitle(query));
    if (reason) logRejection(row.name, reason);
    return !reason;
  });
}

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
      files: current.files ?? row.files,
      fileListURL: current.fileListURL ?? row.fileListURL,
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
  options: {
    timeoutMs?: number; signal?: AbortSignal; onUpdate?: (s: ReleaseSnapshot) => void;
    /** Lowercased info-hashes and links found fake before (default: the ones remembered in this browser). */
    blocked?: Set<string>;
    /** Read the top releases' file lists before finishing (default on). */
    checkFiles?: boolean;
  } = {},
): Promise<ReleaseSnapshot> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const blocked = options.blocked ?? badReleases();
  let snapshot: ReleaseSnapshot = { releases: [], failures: [], pending: providers.map((p) => p.id), hidden: 0 };
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
    const kept = screenReleases(rows, query, blocked);
    const pending = snapshot.pending.filter((id) => id !== provider.id);
    snapshot = {
      releases: mergeReleases(snapshot.releases, kept),
      failures: failure ? [...snapshot.failures, failure] : snapshot.failures,
      pending,
      hidden: (snapshot.hidden ?? 0) + rows.length - kept.length,
      checkingFiles: pending.length === 0 && options.checkFiles !== false,
    };
    options.onUpdate?.(snapshot);
  }));
  if (!snapshot.checkingFiles || options.signal?.aborted) return snapshot;
  const rejected = await fileRejections(fileListCandidates(snapshot.releases), options.signal);
  for (const r of snapshot.releases) { const reason = rejected.get(releaseKey(r)); if (reason) logRejection(r.name, reason); }
  snapshot = {
    ...snapshot,
    releases: snapshot.releases.filter((r) => !rejected.has(releaseKey(r))),
    hidden: (snapshot.hidden ?? 0) + rejected.size,
    checkingFiles: false,
  };
  if (!options.signal?.aborted) options.onUpdate?.(snapshot);
  return snapshot;
}
