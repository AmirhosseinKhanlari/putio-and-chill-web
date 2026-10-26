/** The Pirate Bay through apibay.org (port of the iPhone app's ApibayProvider). apibay doesn't allow browser
 * requests, so it goes through the app's /proxy/apibay. */
import { parseReleaseName } from "../../lib/releaseName";
import { makeMagnet, normalizeHash } from "./magnet";
import { proxyURL } from "./proxyTargets";
import { fetchJSON, lossyNumber, matchesQuery, searchText, type Release, type ReleaseQuery, type SourceProvider } from "./types";

interface Item { id: string; name: string; info_hash: string; seeders: string; size: string; category?: string }

/** The Pirate Bay's 3xx categories are applications and 4xx games: never a movie or an episode, whatever the name. */
export const isProgramCategory = (category?: string) => { const code = Number(category); return code >= 300 && code < 500; };

/** `f.php?id=…` lists a torrent's files; read only for the few releases worth checking. */
export const apibayFileListURL = (id: string) => proxyURL("apibay", `f.php?${new URLSearchParams({ id })}`);

export const apibay: SourceProvider = {
  id: "apibay",
  async releases(query: ReleaseQuery, signal?: AbortSignal): Promise<Release[]> {
    const params = new URLSearchParams({ q: searchText(query), cat: "0" });
    const items = await fetchJSON<Item[]>("apibay", proxyURL("apibay", `q.php?${params}`), { signal });
    return (Array.isArray(items) ? items : []).flatMap((item): Release[] => {
      // "No results" comes back as one row with id 0 and an all-zero hash.
      const hash = normalizeHash(item.info_hash);
      if (item.id === "0" || !hash || /^0+$/.test(hash) || isProgramCategory(item.category)) return [];
      const parsed = parseReleaseName(item.name);
      if (!matchesQuery(parsed, query)) return [];
      return [{ name: item.name, link: makeMagnet(hash, item.name), infoHash: hash, sizeBytes: lossyNumber(item.size), seeders: lossyNumber(item.seeders), sources: ["TPB"], parsed, fileListURL: apibayFileListURL(item.id) }];
    });
  },
};
