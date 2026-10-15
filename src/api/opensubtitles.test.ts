import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeText, download, findSubtitles, OpenSubtitlesError, openSubtitlesCode, parseSearch, searchURL } from "./opensubtitles";

afterEach(() => vi.unstubAllGlobals());

describe("searchURL", () => {
  it("asks for an episode by the show's TMDB id, with sorted lowercase parameters", () => {
    expect(searchURL({ tmdbID: 1399, kind: "tv", season: 2, episode: 5, languages: ["EN"] }))
      .toBe("https://api.opensubtitles.com/api/v1/subtitles?episode_number=5&languages=en&parent_tmdb_id=1399&season_number=2&type=episode");
  });

  it("asks for a movie by TMDB id, or by title text", () => {
    expect(searchURL({ tmdbID: 550, kind: "movie", languages: ["pt-br", "en"] }))
      .toBe("https://api.opensubtitles.com/api/v1/subtitles?languages=en%2Cpt-br&tmdb_id=550&type=movie");
    expect(searchURL({ query: "Fight Club", languages: ["en"] }))
      .toBe("https://api.opensubtitles.com/api/v1/subtitles?languages=en&query=fight%20club");
  });

  it("uses OpenSubtitles' regional codes", () => {
    expect([openSubtitlesCode("pt"), openSubtitlesCode("zh"), openSubtitlesCode("FR"), openSubtitlesCode(null)]).toEqual(["pt-pt", "zh-cn", "fr", "en"]);
  });
});

describe("parseSearch", () => {
  it("puts human-made, trusted, popular subtitles first", () => {
    const results = parseSearch({
      data: [
        { attributes: { language: "en", release: "Machine", download_count: 9000, machine_translated: true, files: [{ file_id: 1 }] } },
        { attributes: { language: "en", release: "Popular", download_count: 500, files: [{ file_id: 2 }] } },
        { attributes: { language: "en", release: "", download_count: 10, from_trusted: true, files: [{ file_id: 3, file_name: "trusted.srt" }] } },
        { attributes: { language: "en", release: "No file", files: [] } },
      ],
    });
    expect(results.map((r) => [r.fileID, r.release])).toEqual([[3, "trusted.srt"], [2, "Popular"], [1, "Machine"]]);
  });
});

describe("requests", () => {
  it("falls back to the title when the TMDB id finds nothing", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      const data = url.includes("query=") ? [{ attributes: { language: "en", release: "By title", files: [{ file_id: 9 }] } }] : [];
      return new Response(JSON.stringify({ data }), { status: 200 });
    }));
    const results = await findSubtitles("key", { tmdbID: 1, kind: "movie", title: "Some Movie", language: "en" });
    expect(results.map((r) => r.release)).toEqual(["By title"]);
    expect(urls).toHaveLength(2);
  });

  it("sends the API key and reports a bad one", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(findSubtitles("bad", { tmdbID: 1, kind: "movie", language: "en" })).rejects.toMatchObject({ problem: "key" });
    expect((fetch.mock.calls[0] as unknown[])[1]).toMatchObject({ headers: { "Api-Key": "bad" } });
  });

  it("downloads: link, then the file; the day's limit is reported plainly", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/download")) {
        expect(JSON.parse(String(init?.body))).toEqual({ file_id: 5 });
        return new Response(JSON.stringify({ link: "https://dl.example/5.srt", remaining: 17 }), { status: 200 });
      }
      return new Response("1\n00:00:01,000 --> 00:00:02,000\nHi\n", { status: 200, headers: { "content-type": "application/x-subrip" } });
    }));
    expect(await download("key", 5)).toEqual({ text: "1\n00:00:01,000 --> 00:00:02,000\nHi\n", remaining: 17 });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 406 })));
    const error = await download("key", 5).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenSubtitlesError);
    expect((error as OpenSubtitlesError).problem).toBe("quota");
  });

  it("goes through the app's proxy when the file's host refuses the browser", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith("/download")) return new Response(JSON.stringify({ link: "https://dl.example/5.srt" }), { status: 200 });
      if (url.startsWith("https://dl.example")) throw new TypeError("Failed to fetch");
      return new Response("subtitle", { status: 200 });
    }));
    expect((await download("key", 5)).text).toBe("subtitle");
    expect(urls[2]).toBe("/proxy/opensubtitles/file?url=https%3A%2F%2Fdl.example%2F5.srt");
  });
});

describe("decodeText", () => {
  it("reads Latin-1 files that aren't UTF-8", () => {
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]).buffer)).toBe("café");
    expect(decodeText(new TextEncoder().encode("café").buffer as ArrayBuffer)).toBe("café");
  });
});
