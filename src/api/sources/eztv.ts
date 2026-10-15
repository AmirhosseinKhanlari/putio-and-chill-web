/** EZTV (port of the iPhone app's EZTVProvider): episodes and season packs of a show, by IMDb id, up to three pages
 * of 100. Allows browser requests, so it's called directly. */
import { parseReleaseName } from "../../lib/releaseName";
import { makeMagnet, normalizeHash } from "./magnet";
import { fetchJSON, lossyNumber, type Release, type ReleaseQuery, type SourceProvider } from "./types";

const BASE = "https://eztvx.to";
const PAGE_SIZE = 100;
const MAX_PAGES = 3;

interface Torrent {
  hash?: string; filename?: string; title?: string; season?: unknown; episode?: unknown;
  seeds?: unknown; size_bytes?: unknown; magnet_url?: string;
}

export const eztv: SourceProvider = {
  id: "eztv",
  async releases(query: ReleaseQuery, signal?: AbortSignal): Promise<Release[]> {
    if ((query.kind !== "episode" && query.kind !== "season") || !query.imdbID) return [];
    const digits = query.imdbID.replace(/^tt/, "");
    const torrents: Torrent[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(`${BASE}/api/get-torrents`);
      url.searchParams.set("imdb_id", digits);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("page", String(page));
      const batch = (await fetchJSON<{ torrents?: Torrent[] }>("eztv", url.toString(), { signal })).torrents ?? [];
      torrents.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    const wantedEpisode = query.kind === "episode" ? query.episode : undefined;
    return torrents.flatMap((t): Release[] => {
      const name = t.title || t.filename || "";
      const parsed = parseReleaseName(name);
      const season = lossyNumber(t.season) ?? parsed.season;
      const episode = lossyNumber(t.episode) ?? parsed.episode;
      if (season !== query.season) return [];
      const isSeasonPack = parsed.season !== undefined && parsed.episode === undefined;
      if (wantedEpisode !== undefined ? episode !== wantedEpisode : !(episode === 0 || episode === undefined || isSeasonPack)) return [];
      const hash = normalizeHash(t.hash);
      const link = t.magnet_url || (hash ? makeMagnet(hash, name) : "");
      if (!link) return [];
      return [{ name, link, infoHash: hash, sizeBytes: lossyNumber(t.size_bytes), seeders: lossyNumber(t.seeds), sources: ["EZTV"], parsed }];
    });
  },
};
