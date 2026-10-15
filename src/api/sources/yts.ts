/** YTS (port of the iPhone app's YTSProvider): movies only, looked up by IMDb id (or by title when there is none).
 * Allows browser requests, so it's called directly. */
import { parseReleaseName } from "../../lib/releaseName";
import { makeMagnet, normalizeHash } from "./magnet";
import { fetchJSON, matchesQuery, type Release, type ReleaseQuery, type SourceProvider } from "./types";

const BASE = "https://movies-api.accel.li";

interface Response {
  data?: { movies?: { title: string; year: number; torrents?: Torrent[] }[] };
}
interface Torrent { hash: string; quality: string; type?: string; video_codec?: string; seeds?: number; size_bytes?: number }

export const yts: SourceProvider = {
  id: "yts",
  async releases(query: ReleaseQuery, signal?: AbortSignal): Promise<Release[]> {
    if (query.kind !== "movie") return [];
    const url = new URL(`${BASE}/api/v2/list_movies.json`);
    url.searchParams.set("query_term", query.imdbID ?? query.title);
    url.searchParams.set("limit", "5");
    const response = await fetchJSON<Response>("yts", url.toString(), { signal });
    return (response.data?.movies ?? []).flatMap((movie) =>
      (movie.torrents ?? []).flatMap((t): Release[] => {
        const hash = normalizeHash(t.hash);
        if (!hash) return [];
        // YTS has no release names; this one carries what the parser needs.
        const name = `${movie.title} (${movie.year}) [${t.quality}] [${(t.type ?? "web").toUpperCase()}] [YTS]`;
        const parsed = parseReleaseName(name);
        parsed.title = movie.title;
        parsed.codec = t.video_codec?.toLowerCase() === "x265" ? "H.265" : "H.264";
        // By IMDb id it's the right movie; by title YTS also returns others.
        if (!query.imdbID && !matchesQuery(parsed, query)) return [];
        return [{ name, link: makeMagnet(hash, movie.title), infoHash: hash, sizeBytes: t.size_bytes, seeders: t.seeds, sources: ["YTS"], parsed }];
      }),
    );
  },
};
