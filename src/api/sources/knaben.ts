/** Knaben, a search across many trackers (port of the iPhone app's KnabenProvider). Its API is a JSON POST and
 * doesn't allow browser requests, so it goes through the app's /proxy/knaben. */
import { parseReleaseName } from "../../lib/releaseName";
import { infoHashFromMagnet, makeMagnet, normalizeHash } from "./magnet";
import { proxyURL } from "./proxyTargets";
import { fetchJSON, lossyNumber, matchesQuery, searchText, type Release, type ReleaseQuery, type SourceProvider } from "./types";

interface Hit { title: string; hash?: string | null; magnetUrl?: string | null; link?: string | null; bytes?: unknown; seeders?: unknown }

export const knaben: SourceProvider = {
  id: "knaben",
  async releases(query: ReleaseQuery, signal?: AbortSignal): Promise<Release[]> {
    const body = {
      search_type: "100%", search_field: "title", query: searchText(query), size: 50,
      order_by: "seeders", order_direction: "desc", hide_unsafe: true, hide_xxx: true,
    };
    const response = await fetchJSON<{ hits?: Hit[] }>("knaben", proxyURL("knaben", "v1"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
    });
    return (response.hits ?? []).flatMap((hit): Release[] => {
      if (!hit.title) return [];
      const hash = normalizeHash(hit.hash) ?? (hit.magnetUrl ? infoHashFromMagnet(hit.magnetUrl) : undefined);
      const link = hit.magnetUrl || (hash ? makeMagnet(hash, hit.title) : hit.link || "");
      if (!link) return [];
      const parsed = parseReleaseName(hit.title);
      if (!matchesQuery(parsed, query)) return [];
      return [{ name: hit.title, link, infoHash: hash, sizeBytes: lossyNumber(hit.bytes), seeders: lossyNumber(hit.seeders), sources: ["Knaben"], parsed }];
    });
  },
};
