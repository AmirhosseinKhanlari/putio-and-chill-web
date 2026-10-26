/** Releases that downloaded as a fake (a program, or no video), by lowercased info-hash or link: never offered again
 * (the iPhone app keeps the same list in its local state). */
import type { Release } from "../api/sources/types";
import { readJSON, writeJSON } from "./storage";

const KEY = "pc.badReleases.v1";

export const badReleases = (): Set<string> => new Set(readJSON<string[]>(KEY, []));

/** The keys a fake release is remembered by: its lowercased info-hash and link. */
export function badReleaseKeys(hash?: string | null, link?: string | null): string[] {
  return [hash, link].map((v) => v?.trim().toLowerCase()).filter((v): v is string => Boolean(v));
}

export function rememberBadRelease(keys: string[]): void {
  if (!keys.length) return;
  writeJSON(KEY, [...new Set([...badReleases(), ...keys])].slice(-500));
}

/** Whether `release` is one of `blocked`, by info-hash or link. */
export function isBlocked(release: Pick<Release, "infoHash" | "link">, blocked: Set<string>): boolean {
  if (!blocked.size) return false;
  return (release.infoHash !== undefined && blocked.has(release.infoHash.toLowerCase())) || blocked.has(release.link.toLowerCase());
}
