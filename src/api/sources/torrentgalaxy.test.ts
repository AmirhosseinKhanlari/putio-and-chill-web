/** Fixtures are real torrentgalaxy.info pages (October 2026), trimmed to the results table or the detail page's
 * download and info blocks. In the movie page one row was switched to Books and one given a magnet link, to cover both. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseReleaseName } from "../../lib/releaseName";
import detailPage from "./fixtures/torrentgalaxy-detail.html?raw";
import emptyPage from "./fixtures/torrentgalaxy-search-empty.html?raw";
import moviePage from "./fixtures/torrentgalaxy-search-movie.html?raw";
import tvPage from "./fixtures/torrentgalaxy-search-tv.html?raw";
import { searchReleases } from "./index";
import { makeMagnet } from "./magnet";
import { forwardHeaders, proxyTargets, resolveProxy } from "./proxyTargets";
import { keywords, parseDetailHash, parseSearchPage, toBytes, torrentGalaxy, torrentGalaxySource } from "./torrentgalaxy";
import type { ReleaseQuery, SourceProvider } from "./types";

const DETAIL_HASH = "C2F364BA7F59B22A1845B16FD8A1FC1783568F8B";
const GiB = 1024 ** 3;
/** The post id padded to 40 hex digits: each torrent gets its own hash. */
const hashFor = (id: string) => id.padEnd(40, "0");
const dune: ReleaseQuery = { kind: "movie", title: "Dune: Part Two", year: 2024, imdbID: "tt15239678" };

/** Search pages answer with `search`; detail pages with the detail fixture, its hash swapped for the post's. Posts in
 * `redirected` answer the way the site sometimes does, with a redirect to its home page (a browser fetch with redirect
 * "manual" then sees status 0, Node sees the 302; neither is ok). */
function mockSite(search: string, redirected: string[] = []) {
  const fn = vi.fn(async (url: string, _init?: RequestInit) => {
    const id = /\/post-detail\/([^/]+)\//.exec(url)?.[1];
    if (!id) return new Response(search, { status: 200, headers: { "Content-Type": "text/html" } });
    if (redirected.includes(id)) return new Response(null, { status: 302 });
    return new Response(detailPage.replaceAll(DETAIL_HASH, hashFor(id).toUpperCase()), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const detailCalls = (fn: ReturnType<typeof mockSite>) => fn.mock.calls.map(([url]) => url).filter((url) => url.includes("/post-detail/"));
afterEach(() => { vi.unstubAllGlobals(); });

describe("TorrentGalaxy parsing", () => {
  it("reads name, detail link, category, size, seeders and leechers", () => {
    const rows = parseSearchPage(moviePage);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({
      name: "Dune Part Two (2024) [1080p] [BluRay]", detailPath: "/post-detail/8a732c/dune-part-two-2024-1080p-bluray/",
      category: "Movies", sizeBytes: Math.round(3.1 * GiB), seeders: 527, leechers: 52, infoHash: undefined,
    });
    expect(rows[1]).toMatchObject({ name: "Dune: Part Two 2024 2160p web YTS", sizeBytes: Math.round(7.4 * GiB) });
    expect(rows[3].category).toBe("Books");
    expect(rows[4]).toMatchObject({ seeders: 251, infoHash: "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12" });

    const tv = parseSearchPage(tvPage);
    expect(tv.map((r) => r.category)).toEqual(["TV", "TV", "TV", "TV"]);
    expect(tv[1].sizeBytes).toBe(Math.round(507.5 * 1024 ** 2));
    expect(tv[0].seeders).toBe(20330);
  });

  it("finds nothing on a no-results page", () => {
    expect(parseSearchPage(emptyPage)).toEqual([]);
  });

  it("takes the torrent's own hash from its detail page, never a similar torrent's", () => {
    expect(parseDetailHash(detailPage)).toBe(DETAIL_HASH.toLowerCase());
    const noField = detailPage.replace("Info Hash:", "Checksum:");
    expect(parseDetailHash(noField)).toBe(DETAIL_HASH.toLowerCase());
    expect(parseDetailHash(noField.replace("dl-magnet", "dl-other"))).toBeUndefined();
  });

  it("searches without punctuation and counts sizes in 1024s", () => {
    expect(keywords("Dune: Part Two 2024")).toBe("Dune Part Two 2024");
    expect(keywords("Grey's Anatomy S20E01")).toBe("Greys Anatomy S20E01");
    expect(toBytes("1.5", "GB")).toBe(1_610_612_736);
    expect(toBytes("1,024", "KB")).toBe(1_048_576);
  });
});

describe("TorrentGalaxy source", () => {
  it("searches through the proxy and builds magnets from detail-page hashes", async () => {
    const fetch = mockSite(moviePage);
    const rows = await torrentGalaxy.releases(dune);
    expect(fetch.mock.calls[0][0]).toBe("/proxy/torrentgalaxy/get-posts/keywords:Dune%20Part%20Two%202024:order:-se/");
    // The Books row is skipped; the row with its own magnet needs no detail page.
    expect(rows.map((r) => r.seeders)).toEqual([527, 299, 89, 251]);
    expect(detailCalls(fetch)).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      infoHash: hashFor("8a732c"), sizeBytes: Math.round(3.1 * GiB), sources: ["TorrentGalaxy"],
      link: makeMagnet(hashFor("8a732c"), "Dune Part Two (2024) [1080p] [BluRay]"),
    });
    expect(rows[0].parsed.resolution).toBe(1080);
    expect(rows[3].infoHash).toBe("ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12");
  });

  it("reads only the best seeded detail pages and skips pages the site redirects away", async () => {
    const fetch = mockSite(moviePage);
    expect((await torrentGalaxySource(1).releases(dune)).map((r) => r.seeders)).toEqual([527, 251]);
    expect(detailCalls(fetch)).toEqual(["/proxy/torrentgalaxy/post-detail/8a732c/dune-part-two-2024-1080p-bluray/"]);
    expect(fetch.mock.calls[1][1]?.redirect).toBe("manual");

    mockSite(moviePage, ["89bee9"]);
    expect((await torrentGalaxy.releases(dune)).map((r) => r.seeders)).toEqual([527, 89, 251]);
  });

  it("returns nothing for a no-results page, with one request", async () => {
    const fetch = mockSite(emptyPage);
    expect(await torrentGalaxy.releases({ kind: "text", text: "zzqxjvwnotarealtitle 1987" })).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the episode or the season pack asked for, through the aggregator", async () => {
    const fetch = mockSite(tvPage);
    const episode = await searchReleases({ kind: "episode", title: "The Last of Us", season: 2, episode: 2 }, [torrentGalaxy]);
    expect(fetch.mock.calls[0][0]).toBe("/proxy/torrentgalaxy/get-posts/keywords:The%20Last%20of%20Us%20S02E02:order:-se/");
    expect(episode.failures).toEqual([]);
    expect(episode.releases.map((r) => r.name)).toEqual(["The Last of Us S02E02 1080p WEB H264 SuccessfulCrab EZTV", "The Last of Us S02E02 480p x264 mSD EZTV"]);

    const season = await searchReleases({ kind: "season", title: "The Last of Us", season: 2 }, [torrentGalaxy]);
    expect(season.releases.map((r) => r.name)).toEqual(["The Last of Us S02 1080p x265 ELiTE"]);
  });

  it("merges with the same torrent from another source by hash, and a failure doesn't stop the others", async () => {
    mockSite(moviePage);
    const tpb: SourceProvider = { id: "apibay", releases: async () => [{
      name: "Dune.Part.Two.2024.1080p.BluRay", link: makeMagnet(hashFor("8a732c"), "x"), infoHash: hashFor("8a732c"),
      seeders: 900, sources: ["TPB"], parsed: parseReleaseName("Dune.Part.Two.2024.1080p.BluRay"),
    }] };
    const both = await searchReleases(dune, [torrentGalaxy, tpb]);
    expect(both.releases).toHaveLength(4);
    expect(both.releases.find((r) => r.infoHash === hashFor("8a732c"))).toMatchObject({ seeders: 900 });
    expect(both.releases.find((r) => r.infoHash === hashFor("8a732c"))?.sources.sort()).toEqual(["TPB", "TorrentGalaxy"]);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const broken = await searchReleases(dune, [torrentGalaxy, tpb]);
    expect(broken.releases).toHaveLength(1);
    expect(broken.failures).toEqual([{ source: "torrentgalaxy", message: "TorrentGalaxy answered 503." }]);
  });
});

describe("TorrentGalaxy proxy", () => {
  it("only reads, and asks like a browser", () => {
    expect(resolveProxy("/proxy/torrentgalaxy/get-posts/keywords:Dune%202021:order:-se/")?.url).toBe("https://torrentgalaxy.info/get-posts/keywords:Dune%202021:order:-se/");
    expect(proxyTargets.torrentgalaxy.methods).toEqual(["GET", "HEAD"]);
    const headers = forwardHeaders(proxyTargets.torrentgalaxy, [["Accept", "*/*"], ["Cookie", "c"], ["User-Agent", "x"]]);
    expect(headers.accept).toBe("text/html,application/xhtml+xml");
    expect(headers["user-agent"]).toMatch(/^Mozilla\/5\.0 /);
    expect(Object.keys(headers).sort()).toEqual(["accept", "user-agent"]);
  });
});
