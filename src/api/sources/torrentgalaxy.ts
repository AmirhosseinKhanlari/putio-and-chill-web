/** TorrentGalaxy (port of the iPhone app's TorrentGalaxyProvider): torrentgalaxy.info's HTML search, most seeded
 * first. Its list has no info-hashes, so the detail pages of the best few matches are read for theirs, a few at a
 * time; matches without a hash are left out (put.io needs a magnet link). The site doesn't allow browser requests,
 * so it goes through the app's /proxy/torrentgalaxy. */
import { parseReleaseName } from "../../lib/releaseName";
import { infoHashFromMagnet, makeMagnet, normalizeHash } from "./magnet";
import { proxyURL } from "./proxyTargets";
import { anySignal, fetchText, matchesQuery, searchText, type Release, type ReleaseQuery, type SourceProvider } from "./types";

export interface TorrentGalaxyRow {
  name: string;
  /** "/post-detail/8a732c/dune-part-two-2024-1080p-bluray/" */
  detailPath: string;
  category?: string;
  sizeBytes?: number;
  seeders?: number;
  leechers?: number;
  /** Only when the row carries its own magnet link (the home page and "similar torrents" lists do). */
  infoHash?: string;
}

/** Categories that are never a movie or an episode. */
const skippedCategories = new Set(["XXX", "Music", "Books", "Apps", "Games"]);
const PARALLEL_DETAILS = 4;
/** One slow page shouldn't use up the whole search's time. */
const DETAIL_TIMEOUT_MS = 5_000;

/** The rows of a search page. Tolerant on purpose: whitespace, attribute order and extra markup can change. */
export function parseSearchPage(html: string): TorrentGalaxyRow[] {
  return html.split('<div class="tgxtablerow').slice(1).flatMap((chunk) => parseRow(chunk) ?? []);
}

function parseRow(html: string): TorrentGalaxyRow | undefined {
  // The name is the first detail link with text; the download icons link there too, without text.
  const link = [...html.matchAll(/<a\b[^>]*\bhref="(\/post-detail\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].find((m) => plainText(m[2]));
  if (!link) return undefined;
  // Size and health come after the name, so a size inside the name can't be taken for the torrent's.
  const rest = html.slice((link.index ?? 0) + link[0].length);
  const size = />(?:\s|&nbsp;)*([\d.,]+)(?:\s|&nbsp;)*([KMGT]i?B|B)(?:\s|&nbsp;)*</.exec(rest);
  const health = /Seeders\/Leechers"[^>]*>[\s\S]*?<b>\s*([\d,]+)\s*<\/b>[\s\S]*?<b>\s*([\d,]+)\s*<\/b>/.exec(rest);
  const count = (s: string | undefined) => (s === undefined ? undefined : Number(s.replace(/,/g, "")));
  return {
    name: plainText(link[2]),
    detailPath: link[1],
    category: /\/get-posts\/category:([A-Za-z0-9 ]+)/.exec(html)?.[1],
    sizeBytes: size ? toBytes(size[1], size[2]) : undefined,
    seeders: count(health?.[1]),
    leechers: count(health?.[2]),
    infoHash: normalizeHash(/magnet:\?xt=urn:btih:([A-Za-z0-9]{32,40})/.exec(html)?.[1]),
  };
}

/** The torrent's own hash on its detail page: the "Info Hash" field, else the main Magnet Download button. Never the
 * first magnet on the page, since "similar torrents" lists carry theirs too. */
export function parseDetailHash(html: string): string | undefined {
  const field = /Info Hash:[\s\S]{0,400}?\b([0-9A-Fa-f]{40})\b/.exec(html);
  if (field) return normalizeHash(field[1]);
  const button = /<a\b[^>]*\bclass="[^"]*\bdl-magnet\b[^"]*"[^>]*\bhref="(magnet:[^"]+)"/.exec(html);
  return button ? infoHashFromMagnet(decodeEntities(button[1])) : undefined;
}

/** "3.1 GB" → bytes. The site counts in 1024s, as torrent sites do. */
export function toBytes(number: string, unit: string): number | undefined {
  const value = Number(number.replace(/,/g, ""));
  if (!Number.isFinite(value)) return undefined;
  const power: Record<string, number> = { K: 1, M: 2, G: 3, T: 4 };
  return Math.round(value * 1024 ** (power[unit[0].toUpperCase()] ?? 0));
}

/** The words to search with. The site splits its search path on ":", and finds "Grey's" as "Greys". */
export function keywords(text: string): string {
  return text.replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function searchPath(query: ReleaseQuery): string {
  return proxyURL("torrentgalaxy", `get-posts/keywords:${encodeURIComponent(keywords(searchText(query)))}:order:-se/`);
}

/** TorrentGalaxy with at most `detailLimit` detail pages read per search. */
export function torrentGalaxySource(detailLimit = 8): SourceProvider {
  return {
    id: "torrentgalaxy",
    async releases(query: ReleaseQuery, signal?: AbortSignal): Promise<Release[]> {
      const html = await fetchText("torrentgalaxy", searchPath(query), { signal, headers: { Accept: "text/html" } });
      const matches = parseSearchPage(html)
        .filter((row) => !skippedCategories.has(row.category ?? ""))
        .map((row) => ({ row, parsed: parseReleaseName(row.name) }))
        .filter((m) => matchesQuery(m.parsed, query));
      const needed = matches.filter((m) => !m.row.infoHash)
        .sort((a, b) => (b.row.seeders ?? -1) - (a.row.seeders ?? -1))
        .slice(0, detailLimit).map((m) => m.row.detailPath);
      const fetched = await detailHashes(needed, signal);
      return matches.flatMap(({ row, parsed }): Release[] => {
        const hash = row.infoHash ?? fetched.get(row.detailPath);
        if (!hash) return [];
        return [{ name: row.name, link: makeMagnet(hash, row.name), infoHash: hash, sizeBytes: row.sizeBytes, seeders: row.seeders, sources: ["TorrentGalaxy"], parsed }];
      });
    },
  };
}

export const torrentGalaxy = torrentGalaxySource();

/** Detail path → info-hash, a few pages at a time. A page that fails, redirects or has no hash is skipped. */
async function detailHashes(paths: string[], signal?: AbortSignal): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const queue = [...paths];
  const worker = async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      const hash = await detailHash(path, signal);
      if (hash) found.set(path, hash);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_DETAILS, paths.length) }, worker));
  return found;
}

async function detailHash(path: string, signal?: AbortSignal): Promise<string | undefined> {
  const timeout = AbortSignal.timeout(DETAIL_TIMEOUT_MS);
  try {
    // The site sometimes redirects a detail page to its home page (seen after bursts of requests); "manual" makes
    // that an error instead of a download of the home page.
    const html = await fetchText("torrentgalaxy", proxyURL("torrentgalaxy", path), {
      signal: signal ? anySignal([signal, timeout]) : timeout, redirect: "manual", headers: { Accept: "text/html" },
    });
    return parseDetailHash(html);
  } catch (error) {
    if (signal?.aborted) throw error;
    return undefined;
  }
}

/** Tags removed, entities decoded, whitespace collapsed. */
function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
