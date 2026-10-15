import { afterEach, describe, expect, it, vi } from "vitest";
import { parseReleaseName } from "../../lib/releaseName";
import { apibay } from "./apibay";
import { eztv } from "./eztv";
import { enabledProviders, mergeReleases, searchReleases, sortReleases } from "./index";
import { knaben } from "./knaben";
import { infoHashFromMagnet, makeMagnet, normalizeHash } from "./magnet";
import { allowsMethod, forwardHeaders, isSubtitleFileURL, proxyTargets, proxyURL, resolveProxy } from "./proxyTargets";
import { torrentsCSV } from "./torrentscsv";
import { matchesQuery, searchText, type Release, type SourceProvider } from "./types";
import { yts } from "./yts";

const HASH = "2770fe270845674966e184be60ed1be0fe494f3a";
const row = (name: string, extra: Partial<Release> = {}): Release => ({ name, link: `magnet:?xt=urn:btih:${HASH}`, infoHash: HASH, sources: ["A"], parsed: parseReleaseName(name), ...extra });

function mockFetch(body: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("magnet", () => {
  it("normalizes hex and base32 hashes", () => {
    expect(normalizeHash(HASH.toUpperCase())).toBe(HASH);
    expect(normalizeHash("E5HJAXEJXJOV5R6AYFJYTEMCQKKZQBRX")).toMatch(/^[0-9a-f]{40}$/);
    expect(normalizeHash("nope")).toBeUndefined();
  });

  it("builds magnet links with trackers and reads them back", () => {
    const link = makeMagnet(HASH, "Dune Part Two (2024)");
    expect(link.startsWith(`magnet:?xt=urn:btih:${HASH}&dn=Dune+Part+Two+%282024%29&tr=udp%3A%2F%2F`)).toBe(true);
    expect(infoHashFromMagnet(link)).toBe(HASH);
  });
});

describe("relevance", () => {
  const ep = { kind: "episode", title: "Severance", season: 2, episode: 4 } as const;
  it("keeps the episode asked for, including multi-episode files", () => {
    expect(matchesQuery(parseReleaseName("Severance.S02E04.1080p.WEB"), ep)).toBe(true);
    expect(matchesQuery(parseReleaseName("Severance.S02E03-E05.1080p.WEB"), ep)).toBe(true);
    expect(matchesQuery(parseReleaseName("Severance.S02E05.1080p.WEB"), ep)).toBe(false);
    expect(matchesQuery(parseReleaseName("Severance.S02.1080p.WEB"), ep)).toBe(false);
  });
  it("keeps season packs for a season, and the right movie within a year", () => {
    expect(matchesQuery(parseReleaseName("Severance.S02.1080p.WEB"), { kind: "season", title: "Severance", season: 2 })).toBe(true);
    const movie = { kind: "movie", title: "Dune: Part Two", year: 2024 } as const;
    expect(matchesQuery(parseReleaseName("Dune.Part.Two.2024.1080p"), movie)).toBe(true);
    expect(matchesQuery(parseReleaseName("Dune.Part.Two.2021.1080p"), movie)).toBe(false);
    expect(matchesQuery(parseReleaseName("Dune.Part.Two.Behind.The.Scenes.2024.1080p"), movie)).toBe(false);
  });
  it("searches with the iPhone app's words", () => {
    expect(searchText({ kind: "episode", title: "Severance", season: 2, episode: 4 })).toBe("Severance S02E04");
    expect(searchText({ kind: "movie", title: "Dune", year: 2021 })).toBe("Dune 2021");
  });
});

describe("merging and ranking", () => {
  it("merges the same hash, keeping the most seeders, every source and a size", () => {
    const merged = mergeReleases([row("Dune.2021.1080p", { seeders: 10, sources: ["TPB"] })], [
      row("Dune.2021.1080p", { seeders: 50, sizeBytes: 5, sources: ["Knaben"] }),
      row("Other.2021.720p", { infoHash: "b".repeat(40), seeders: 1 }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ seeders: 50, sizeBytes: 5, sources: ["TPB", "Knaben"] });
  });
  it("prefers a magnet link over chill's own", () => {
    const merged = mergeReleases([row("X", { link: "https://chill/x" })], [row("X")]);
    expect(merged[0].link.startsWith("magnet:")).toBe(true);
  });
  it("sorts by seeders, size or quality", () => {
    const list = [row("A.720p", { infoHash: "1", seeders: 9, sizeBytes: 1 }), row("B.2160p", { infoHash: "2", seeders: 1, sizeBytes: 9 })];
    expect(sortReleases(list, "seeders")[0].name).toBe("A.720p");
    expect(sortReleases(list, "size")[0].name).toBe("B.2160p");
    expect(sortReleases(list, "quality")[0].name).toBe("B.2160p");
  });
});

describe("searchReleases", () => {
  it("asks every source, reports failures and slow sources, and merges", async () => {
    const ok: SourceProvider = { id: "yts", releases: async () => [row("Dune.2021.1080p", { seeders: 3 })] };
    const ok2: SourceProvider = { id: "apibay", releases: async () => [row("Dune.2021.1080p", { seeders: 7, sources: ["TPB"] })] };
    const broken: SourceProvider = { id: "knaben", releases: async () => { throw new Error("Knaben broke."); } };
    const slow: SourceProvider = { id: "eztv", releases: (_q, signal) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")))) };
    const updates: number[] = [];
    const result = await searchReleases({ kind: "text", text: "Dune" }, [ok, ok2, broken, slow], { timeoutMs: 50, onUpdate: (s) => updates.push(s.pending.length) });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]).toMatchObject({ seeders: 7, sources: ["A", "TPB"] });
    expect(result.failures.map((f) => f.source).sort()).toEqual(["eztv", "knaben"]);
    expect(result.failures.find((f) => f.source === "eztv")?.message).toBe("EZTV didn't answer in time.");
    expect(updates[0]).toBe(4);
    expect(updates.at(-1)).toBe(0);
  });

  it("uses the sources turned on, and chill only when connected", () => {
    const sources = [
      { id: "chill", name: "chill", enabled: true }, { id: "yts", name: "YTS", enabled: true }, { id: "knaben", name: "Knaben", enabled: false },
    ] as const;
    expect(enabledProviders({ sources: [...sources] }).map((p) => p.id)).toEqual(["yts"]);
  });
});

describe("providers", () => {
  it("YTS: one release per torrent, by IMDb id", async () => {
    const fetch = mockFetch({ data: { movies: [{ title: "Dune: Part Two", year: 2024, torrents: [{ hash: HASH.toUpperCase(), quality: "2160p", type: "web", video_codec: "x265", seeds: 40, size_bytes: 9 }] }] } });
    const rows = await yts.releases({ kind: "movie", title: "Dune: Part Two", year: 2024, imdbID: "tt15239678" });
    expect(String(fetch.mock.calls[0][0])).toContain("query_term=tt15239678");
    expect(rows[0]).toMatchObject({ infoHash: HASH, seeders: 40, sizeBytes: 9, sources: ["YTS"] });
    expect(rows[0].parsed).toMatchObject({ title: "Dune: Part Two", resolution: 2160, codec: "H.265", year: 2024 });
    expect(await yts.releases({ kind: "season", title: "X", season: 1 })).toEqual([]);
  });

  it("EZTV: the episode asked for, by IMDb id digits", async () => {
    const fetch = mockFetch({ torrents: [
      { hash: HASH, title: "Severance S02E04 1080p WEB EZTV", season: "2", episode: "4", seeds: 5, size_bytes: "100", magnet_url: "" },
      { hash: "c".repeat(40), title: "Severance S02E05 1080p WEB EZTV", season: "2", episode: "5", seeds: 5 },
      { hash: "d".repeat(40), title: "Severance S02 1080p", season: "2", episode: "0", seeds: 5 },
    ] });
    const rows = await eztv.releases({ kind: "episode", title: "Severance", imdbID: "tt11280740", season: 2, episode: 4 });
    expect(String(fetch.mock.calls[0][0])).toContain("imdb_id=11280740");
    expect(rows.map((r) => r.name)).toEqual(["Severance S02E04 1080p WEB EZTV"]);
    expect(rows[0].link.startsWith(`magnet:?xt=urn:btih:${HASH}`)).toBe(true);
    const pack = await eztv.releases({ kind: "season", title: "Severance", imdbID: "tt11280740", season: 2 });
    expect(pack.map((r) => r.name)).toEqual(["Severance S02 1080p"]);
  });

  it("apibay: through the proxy, skipping the no-results row", async () => {
    const fetch = mockFetch([
      { id: "1", name: "Dune Part Two (2024) [1080p] [WEBRip]", info_hash: HASH.toUpperCase(), seeders: "946", size: "2968337547" },
      { id: "0", name: "No results returned", info_hash: "0".repeat(40), seeders: "0", size: "0" },
    ]);
    const rows = await apibay.releases({ kind: "movie", title: "Dune: Part Two", year: 2024 });
    expect(String(fetch.mock.calls[0][0])).toBe("/proxy/apibay/q.php?q=Dune%3A+Part+Two+2024&cat=0");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seeders: 946, sizeBytes: 2968337547, sources: ["TPB"], infoHash: HASH });
  });

  it("Knaben: a JSON POST through the proxy", async () => {
    const fetch = mockFetch({ hits: [{ title: "Dune Part Two (2024) [1080p]", hash: HASH.toUpperCase(), magnetUrl: null, bytes: 7, seeders: 3 }] });
    const rows = await knaben.releases({ kind: "movie", title: "Dune: Part Two", year: 2024 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/proxy/knaben/v1");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ query: "Dune: Part Two 2024", search_field: "title", size: 50 });
    expect(rows[0]).toMatchObject({ infoHash: HASH, seeders: 3, sources: ["Knaben"] });
  });

  it("Torrents.csv: builds magnet links from hashes", async () => {
    mockFetch({ torrents: [{ infohash: HASH, name: "Dune Part Two (2024) [1080p] [BluRay]", size_bytes: 3, seeders: 536 }] });
    const rows = await torrentsCSV.releases({ kind: "movie", title: "Dune: Part Two", year: 2024 });
    expect(rows[0]).toMatchObject({ seeders: 536, sources: ["Torrents.csv"] });
    expect(rows[0].link.startsWith(`magnet:?xt=urn:btih:${HASH}`)).toBe(true);
  });
});

describe("proxy", () => {
  it("goes only to listed hosts", () => {
    expect(resolveProxy("/proxy/apibay/q.php", "?q=x")?.url).toBe("https://apibay.org/q.php?q=x");
    expect(resolveProxy("/proxy/knaben/v1")?.url).toBe("https://api.knaben.org/v1");
    expect(resolveProxy("/proxy/apibay")?.url).toBe("https://apibay.org/");
    expect(resolveProxy("/proxy/evil/x")).toBeUndefined();
    expect(resolveProxy("/proxy/constructor/x")).toBeUndefined();
    expect(new URL(resolveProxy("/proxy/apibay//evil.example/x")!.url).host).toBe("apibay.org");
    expect(new URL(resolveProxy("/proxy/apibay/@evil.example/x")!.url).host).toBe("apibay.org");
  });
  it("passes on only the needed headers", () => {
    const headers = forwardHeaders(proxyTargets.opensubtitles, [["Api-Key", "k"], ["Cookie", "c"], ["Content-Type", "application/json"], ["Origin", "o"]]);
    expect(headers).toEqual({ "api-key": "k", "content-type": "application/json", "User-Agent": "PutioChill v1.0" });
    expect(proxyURL("knaben", "/v1")).toBe("/proxy/knaben/v1");
  });

  it("lets mymoviz only read, and subtitle files come only from OpenSubtitles over https", () => {
    expect(allowsMethod(proxyTargets.mymoviz, "GET")).toBe(true);
    expect(allowsMethod(proxyTargets.mymoviz, "POST")).toBe(false);
    expect(allowsMethod(proxyTargets.knaben, "POST")).toBe(true);
    expect(isSubtitleFileURL("https://dl.opensubtitles.com/file/1.srt")).toBe(true);
    expect(isSubtitleFileURL("https://opensubtitles.org/x")).toBe(true);
    expect(isSubtitleFileURL("http://dl.opensubtitles.com/x")).toBe(false);
    expect(isSubtitleFileURL("https://opensubtitles.com.evil.example/x")).toBe(false);
    expect(isSubtitleFileURL("https://evilopensubtitles.com/x")).toBe(false);
    expect(isSubtitleFileURL("https://user@dl.opensubtitles.com/x")).toBe(false);
    expect(isSubtitleFileURL(null)).toBe(false);
  });
});
