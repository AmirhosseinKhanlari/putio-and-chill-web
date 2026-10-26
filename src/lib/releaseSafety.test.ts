import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PutioFile, PutioTransfer } from "../api/putio";
import { apibay } from "../api/sources/apibay";
import { clearFileListCache, fileListCandidates, fileRejection, parseApibayFiles } from "../api/sources/fileLists";
import { searchReleases } from "../api/sources/index";
import { parseDetailFiles } from "../api/sources/torrentgalaxy";
import type { Release, SourceProvider } from "../api/sources/types";
import { badReleases, isBlocked } from "./badReleases";
import { downloadVerdict, fakeMessage, FILE_GRACE_MS, reviewFinishedDownload } from "./fakeDownloads";
import { parseReleaseName } from "./releaseName";
import { filesRejection, releaseRejection } from "./releaseSafety";
import { pickCheckedRelease, pickRelease } from "./smartGet";

const MB = 1_048_576;
const GB = 1_073_741_824;
const check = (name: string, size?: number, asked?: string) => releaseRejection(name, size, parseReleaseName(name), asked);
const hash = (c: string) => c.repeat(40);
const rel = (c: string, name: string, extra: Partial<Release> = {}): Release => ({
  name, link: `magnet:?xt=urn:btih:${hash(c)}`, infoHash: hash(c), seeders: 10, sources: ["TPB"], parsed: parseReleaseName(name), ...extra,
});

function memoryStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe("release names and sizes", () => {
  /** Real-style names at real-style sizes, from scene, P2P, YTS, EZTV and anime uploads. */
  const good: [string, number | undefined][] = [
    ["Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX", 31 * GB],
    ["Dune.Part.Two.2024.UHD.BluRay.2160p.TrueHD.Atmos.7.1.DV.HEVC.REMUX-FraMeSToR", 64 * GB],
    ["Dune Part Two 2024 NORDiC 1080p REMUX BluRay AVC DTS-HD MA TrueHD 7 1 Atmos", 34 * GB],
    ["Dune.Part.Two.2024.1080p.WEBRip.1600MB.DD2.0.x264-GalaxyRG", 1600 * MB],
    ["Dune Part Two (2024) [1080p] [WEBRip] [YTS]", 2800 * MB],
    ["Dune Part Two (2024) [720p] [BluRay] [YTS]", 1500 * MB],
    ["Dune.Part.Two.2024.1080p.BluRay.x264.AAC5.1-[YTS.MX].mp4", 3 * GB],
    ["The.Last.of.Us.S02E02.1080p.WEB.h264-ETHEL", 2900 * MB],
    ["The.Bear.S03E01.720p.HDTV.x264-SYNCOPY", 400 * MB],
    ["Bluey.S03E01.1080p.WEB.h264-NOMA", 120 * MB],
    ["Monster The Ed Gein Story S01 1080p HEVC x265-MeGusta", 5 * GB],
    ["Severance.S02.COMPLETE.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX", 80 * GB],
    ["Shogun.2024.S01E01E02.1080p.DSNP.WEB-DL.DDP5.1.H.264-NTb", 5 * GB],
    ["www.UIndex.org    -    Severance S02E04 1080p WEB H264-SuccessfulCrab", 1500 * MB],
    ["[SubsPlease] Sousou no Frieren - 01 (1080p) [ABCDEF12].mkv", 1400 * MB],
    ["Harry Potter Complete 8-Film Collection 2160p UHD BluRay REMUX HDR", 420 * GB],
    ["The.Bat.1959.1080p.BluRay.x264-OFT", 7 * GB],
    ["Old.Movie.1999.SCR.XviD-GROUP", 700 * MB],
    ["Dune.Part.Two.2024.COMPLETE.UHD.BLURAY-SURCODE.iso", 90 * GB],
    ["Some.Movie.2023.1080p.WEB-DL", undefined],
  ];
  it.each(good)("lets %s through", (name, size) => { expect(check(name, size)).toBeUndefined(); });

  it("doesn't count the asked title's own words", () => {
    expect(check("Crack.Cocaine.Corruption.and.Conspiracy.2021.1080p.NF.WEB-DL", 4 * GB, "Crack: Cocaine, Corruption & Conspiracy")).toBeUndefined();
    expect(check("The.Setup.2011.720p.BluRay.x264", 4 * GB, "Setup")).toBeUndefined();
    expect(check("Dune Part Two 2024 1080p Crack", 2 * GB, "Dune: Part Two")).toEqual({ kind: "spam", marker: "crack" });
  });

  it("rejects programs, archives and fake discs", () => {
    expect(check("Dune.Part.Two.2024.1080p.WEB-DL.x264.exe", 2 * GB)).toEqual({ kind: "program", ext: "exe" });
    expect(check("setup.exe", 3 * MB)).toEqual({ kind: "program", ext: "exe" });
    expect(check("Dune Part Two 2024 1080p.exe [TGx]", 2 * GB)).toEqual({ kind: "program", ext: "exe" });
    expect(check("Movie 2025 1080p FULL HD [codec required].zip", 900 * MB)).toEqual({ kind: "archive", ext: "zip" });
    expect(check("Movie.2025.2160p.rar", 20 * GB)).toEqual({ kind: "archive", ext: "rar" });
    expect(check("Movie.2025.1080p.iso", 700 * MB)).toEqual({ kind: "discImage" });
    expect(check("Movie.2025.1080p.BluRay.iso", 40 * GB)).toBeUndefined();
  });

  it("rejects fake wording", () => {
    expect(check("Dune Part Two 2024 1080p WEB-DL [Codec Required]", 2 * GB)).toEqual({ kind: "spam", marker: "codec required" });
    expect(check("Dune Part Two 2024 1080p Keygen", 2 * GB)).toEqual({ kind: "spam", marker: "keygen" });
    expect(check("Dune Part Two 2024 Full Movie Free Download HD", 2 * GB)).toEqual({ kind: "spam", marker: "full movie free" });
    expect(check("Dune Part Two 2024 1080p http://best-movies.xyz", 2 * GB)).toEqual({ kind: "spam", marker: "web address" });
  });

  it("rejects implausible sizes, never unknown ones", () => {
    expect(check("Dune Part Two 2024 1080p", 4 * MB)).toEqual({ kind: "tooSmall", bytes: 4 * MB, minimum: 150 * MB });
    expect(check("Dune.Part.Two.2024.2160p.WEB", 700 * MB)).toEqual({ kind: "tooSmall", bytes: 700 * MB, minimum: GB });
    expect(check("The.Last.of.Us.S02E02.1080p.WEB", 12 * MB)).toEqual({ kind: "tooSmall", bytes: 12 * MB, minimum: 40 * MB });
    expect(check("Severance.S02.1080p.WEB", 60 * MB)).toEqual({ kind: "tooSmall", bytes: 60 * MB, minimum: 80 * MB });
    expect(check("Dune.Part.Two.2024.2160p.REMUX", 200 * GB)).toEqual({ kind: "tooLarge", bytes: 200 * GB, maximum: 150 * GB });
    expect(check("Dune Part Two 2024 1080p")).toBeUndefined();
  });
});

describe("file lists", () => {
  beforeEach(() => clearFileListCache());
  afterEach(() => { vi.unstubAllGlobals(); });

  it("passes a video and rejects programs or no video", () => {
    expect(filesRejection([{ name: "Dune.mp4", sizeBytes: 3 * GB }, { name: "www.YTS.MX.jpg", sizeBytes: 53226 }])).toBeUndefined();
    expect(filesRejection([{ name: "BDMV/STREAM/00001.m2ts", sizeBytes: 30 * GB }])).toBeUndefined();
    expect(filesRejection([{ name: "Dune.mp4", sizeBytes: 2 * GB }, { name: "Codec/Install Codec.exe", sizeBytes: 3 * MB }]))
      .toEqual({ kind: "containsProgram", name: "Install Codec.exe" });
    expect(filesRejection([{ name: "movie.part1.rar", sizeBytes: 900 * MB }, { name: "movie.part2.rar", sizeBytes: 800 * MB }]))
      .toEqual({ kind: "notVideo", largest: "movie.part1.rar" });
    expect(filesRejection([])).toBeUndefined();
  });

  it("reads apibay's answer, including its 'not found' row", () => {
    expect(parseApibayFiles([{ name: ["a.mkv"], size: [123] }, { name: ["b.txt"], size: [1] }])).toEqual([{ name: "a.mkv", sizeBytes: 123 }, { name: "b.txt", sizeBytes: 1 }]);
    expect(parseApibayFiles([{ name: { 0: "Filelist not found" }, size: { 0: "0" } }])).toBeUndefined();
    expect(parseApibayFiles("nope")).toBeUndefined();
  });

  it("reads TorrentGalaxy's file table, skipping the tracker template", () => {
    const html = `<tr><td class="table_col1">Dune.2024.1080p.mp4</td>
      <td class="table_col2">3.1 GB</td></tr><tr><td class="table_col1">YTSProxies.com.txt</td><td class="table_col2">584 bytes</td></tr>
      <td class="table_col1" style="x">\${tracker.tracker}</td><td class="table_col2" align="center"><span>\${tracker.seeders}</span></td>`;
    expect(parseDetailFiles(html)).toEqual([{ name: "Dune.2024.1080p.mp4", sizeBytes: Math.round(3.1 * GB) }, { name: "YTSProxies.com.txt", sizeBytes: 584 }]);
  });

  it("fetches a list once, through the proxy, and counts unreadable lists as fine", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("id=2")) return new Response("busy", { status: 503 });
      return new Response(JSON.stringify([{ name: ["Dune.mp4.lnk"], size: [2000] }, { name: ["Dune.wmv"], size: [90_000_000] }]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const fake = rel("a", "Dune.2024.1080p", { fileListURL: "/proxy/apibay/f.php?id=1" });
    expect(await fileRejection(fake)).toEqual({ kind: "containsProgram", name: "Dune.mp4.lnk" });
    expect(await fileRejection(fake)).toEqual({ kind: "containsProgram", name: "Dune.mp4.lnk" });
    expect(await fileRejection(rel("b", "Dune.2024.1080p", { fileListURL: "/proxy/apibay/f.php?id=2" }))).toBeUndefined();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/proxy/apibay/f.php?id=1", "/proxy/apibay/f.php?id=2"]);
  });

  it("picks the top seeded per quality and every inline list", () => {
    const rows = Array.from({ length: 15 }, (_, i) => rel(i.toString(16), "Dune.2024.1080p", { seeders: 100 - i, fileListURL: `/f?id=${i}` }));
    rows.push(rel("x", "Dune.2024.720p", { seeders: 1, fileListURL: "/f?id=720" }));
    const inline = rel("f", "Dune.2024.2160p", { files: [{ name: "a.mkv", sizeBytes: 1 }] });
    rows.push(inline, rel("y", "No.List.2024.1080p", { seeders: 999 }));
    const picked = fileListCandidates(rows, 10);
    expect(picked).toHaveLength(12);
    expect(picked[0]).toBe(inline);
    expect(picked.some((r) => r.name.includes("720p"))).toBe(true);
    expect(picked.some((r) => r.name.startsWith("No.List"))).toBe(false);
  });

  it("apibay rows carry their list's address and app categories are skipped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      { id: "75005578", name: "Dune Part Two (2024) [1080p] [WEBRip]", info_hash: hash("a"), seeders: "9", size: "2968337547", category: "207" },
      { id: "75005579", name: "Dune Part Two 2024 1080p", info_hash: hash("b"), seeders: "9", size: "2968337547", category: "301" },
    ]), { status: 200 })));
    const rows = await apibay.releases({ kind: "text", text: "Dune Part Two 2024" });
    expect(rows.map((r) => r.fileListURL)).toEqual(["/proxy/apibay/f.php?id=75005578"]);
  });
});

describe("search", () => {
  beforeEach(() => clearFileListCache());
  afterEach(() => { vi.unstubAllGlobals(); });
  const provider = (rows: Release[]): SourceProvider => ({ id: "apibay", releases: async () => rows });

  it("hides fakes by name, size and memory, then checks the top file lists before finishing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes("id=2") ? [{ name: ["codec.exe"], size: [3_000_000] }, { name: ["Dune.wmv"], size: [9_000_000] }] : [{ name: ["Dune.mkv"], size: [2e9] }],
    ), { status: 200 })));
    const rows = [
      rel("a", "Dune.Part.Two.2024.1080p.WEB-DL", { sizeBytes: 2 * GB, fileListURL: "/f?id=1" }),
      rel("b", "Dune.Part.Two.2024.1080p.WEB", { sizeBytes: 2 * GB, seeders: 900, fileListURL: "/f?id=2" }),
      rel("c", "Dune.Part.Two.2024.1080p.WEB-DL.exe", { sizeBytes: 2 * GB }),
      rel("d", "Dune.Part.Two.2024.1080p", { sizeBytes: 4 * MB }),
      rel("e", "Dune.Part.Two.2024.720p.WEB", { sizeBytes: GB }),
    ];
    const updates: { pending: number; checking?: boolean; count: number }[] = [];
    const result = await searchReleases({ kind: "movie", title: "Dune: Part Two", year: 2024 }, [provider(rows)], {
      blocked: new Set([hash("e")]),
      onUpdate: (s) => updates.push({ pending: s.pending.length, checking: s.checkingFiles, count: s.releases.length }),
    });
    expect(result.releases.map((r) => r.infoHash)).toEqual([hash("a")]);
    expect(result.hidden).toBe(4);
    expect(result.checkingFiles).toBe(false);
    expect(updates).toEqual([{ pending: 1, checking: undefined, count: 0 }, { pending: 0, checking: true, count: 2 }, { pending: 0, checking: false, count: 1 }]);
  });

  it("matches remembered fakes by hash or link", () => {
    expect(isBlocked({ link: "https://chill.institute/t/Abc" }, new Set(["https://chill.institute/t/abc"]))).toBe(true);
    expect(isBlocked(rel("a", "x"), new Set([hash("a")]))).toBe(true);
    expect(isBlocked(rel("a", "x"), new Set())).toBe(false);
  });
});

describe("Smart Get", () => {
  const rule = { resolution: 1080, maxSizeGB: 10 } as const;

  it("sets a pick with fake files aside and takes the next", async () => {
    const best = rel("c", "X.2024.1080p.WEB", { seeders: 600 });
    const next = rel("a", "X.2024.1080p.BluRay", { seeders: 50 });
    expect(await pickCheckedRelease([best, next], rule, async (r) => (r === best ? { kind: "containsProgram", name: "codec.exe" } : undefined))).toBe(next);
    expect(await pickCheckedRelease([best], rule, async () => ({ kind: "notVideo", largest: "x.zip" }))).toBeUndefined();
  });

  it("never picks a disc image", () => {
    const iso = rel("c", "X.2024.1080p.BluRay.iso", { seeders: 600 });
    const mkv = rel("a", "X.2024.1080p.BluRay", { seeders: 5 });
    expect(pickRelease([iso, mkv], rule)).toBe(mkv);
  });
});

describe("finished downloads", () => {
  beforeEach(memoryStorage);
  afterEach(() => { (globalThis as { localStorage?: Storage }).localStorage = undefined; });

  /** put.io with a few files; deletions are recorded. */
  function fakePutio(files: Record<number, PutioFile[]>, roots: PutioFile[]) {
    const deleted: number[] = [];
    const all = [...roots, ...Object.values(files).flat()];
    return {
      deleted,
      file: async (id: number) => { const f = all.find((x) => x.id === id); if (!f) throw new Error("404"); return f; },
      list: async (id: number) => ({ files: files[id] ?? [] }),
      deleteFiles: async (ids: number[]) => { deleted.push(...ids); },
    };
  }
  const transfer = (fileID: number): PutioTransfer => ({ id: 9, status: "COMPLETED", file_id: fileID, hash: hash("A") });
  const pending = { transferID: 9, tmdbID: 1, kind: "movie" as const, title: "Dune", releaseName: "Dune.2024.1080p", link: "magnet:?xt=urn:btih:AAA", addedAt: 0 };

  it("removes and remembers a download with a program in it", async () => {
    const putio = fakePutio({ 500: [{ id: 501, name: "Dune.wmv", file_type: "VIDEO" }, { id: 502, name: "Codec", file_type: "FOLDER" }], 502: [{ id: 503, name: "Install Codec.exe" }] },
      [{ id: 500, name: "Dune", file_type: "FOLDER" }]);
    expect(await reviewFinishedDownload(putio, transfer(500), pending, Date.now())).toBe("fake");
    expect(putio.deleted).toEqual([500]);
    expect([...badReleases()].sort()).toEqual([hash("a"), "magnet:?xt=urn:btih:aaa"]);
    expect(fakeMessage).toBe("This download didn't contain a video — it looks fake. Removed it.");
  });

  it("waits before calling a download without video fake", async () => {
    const putio = fakePutio({ 600: [{ id: 601, name: "Movie.zip" }, { id: 602, name: "READ ME.txt" }] }, [{ id: 600, name: "Movie", file_type: "FOLDER" }]);
    const now = Date.now();
    expect(await reviewFinishedDownload(putio, transfer(600), pending, now, now)).toBe("wait");
    expect(putio.deleted).toEqual([]);
    expect(await reviewFinishedDownload(putio, transfer(600), pending, now, now + FILE_GRACE_MS)).toBe("fake");
    expect(putio.deleted).toEqual([600]);
  });

  it("leaves real downloads and empty listings alone", async () => {
    const putio = fakePutio({ 700: [{ id: 701, name: "Dune.mkv", file_type: "VIDEO" }, { id: 702, name: "RARBG.txt" }], 800: [] },
      [{ id: 700, name: "Dune", file_type: "FOLDER" }, { id: 800, name: "Empty", file_type: "FOLDER" }]);
    expect(await reviewFinishedDownload(putio, transfer(700), pending, 0)).toBe("ok");
    expect(await reviewFinishedDownload(putio, transfer(800), pending, Date.now())).toBe("wait");
    expect(putio.deleted).toEqual([]);
    expect(downloadVerdict([{ id: 1, name: "Dune.2024.UHD.BluRay.iso" }])).toEqual({ kind: "video" });
    expect(downloadVerdict([{ id: 1, name: "setup.exe" }])).toEqual({ kind: "program", name: "setup.exe" });
  });
});
