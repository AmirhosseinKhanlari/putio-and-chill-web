/** torrents-csv.com (port of the iPhone app's TorrentsCSVProvider): `GET /service/search?q=…&size=50`. Allows
 * browser requests, so it's called directly. */
import { parseReleaseName } from "../../lib/releaseName";
import { makeMagnet, normalizeHash } from "./magnet";
import { fetchJSON, lossyNumber, matchesQuery, searchText, type Release, type ReleaseQuery, type SourceProvider } from "./types";

const BASE = "https://torrents-csv.com";

interface Torrent { infohash: string; name: string; size_bytes?: unknown; seeders?: unknown }

export const torrentsCSV: SourceProvider = {
  id: "torrentscsv",
  async releases(query: ReleaseQuery, signal?: AbortSignal): Promise<Release[]> {
    const url = new URL(`${BASE}/service/search`);
    url.searchParams.set("q", searchText(query));
    url.searchParams.set("size", "50");
    const response = await fetchJSON<{ torrents?: Torrent[] }>("torrentscsv", url.toString(), { signal });
    return (response.torrents ?? []).flatMap((t): Release[] => {
      const hash = normalizeHash(t.infohash);
      if (!hash) return [];
      const parsed = parseReleaseName(t.name);
      if (!matchesQuery(parsed, query)) return [];
      return [{ name: t.name, link: makeMagnet(hash, t.name), infoHash: hash, sizeBytes: lossyNumber(t.size_bytes), seeders: lossyNumber(t.seeders), sources: ["Torrents.csv"], parsed }];
    });
  },
};
