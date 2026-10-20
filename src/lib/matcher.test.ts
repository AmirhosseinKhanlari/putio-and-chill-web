import { describe, expect, it } from "vitest";
import { normalizeTitle, pickMatch, pickShow } from "./matcher";
import { parseReleaseName } from "./releaseName";

describe("pickMatch", () => {
  const results = [{ title: "Dune", year: 1984 }, { title: "Dune: Part Two", year: 2024 }, { title: "Dune", year: 2021 }];

  it("prefers the exact title with a matching year", () => {
    expect(pickMatch(results, "Dune", 2021)).toEqual({ item: { title: "Dune", year: 2021 }, confidence: 1 });
  });

  it("falls back to the exact title", () => {
    expect(pickMatch(results, "Dune Part Two")?.item.year).toBe(2024);
  });

  it("gives up when nothing fits", () => {
    expect(pickMatch(results, "Arrival", 2016)).toBeUndefined();
  });

  it("ignores accents, punctuation and &", () => {
    expect(normalizeTitle("Shōgun")).toBe(normalizeTitle("Shogun"));
    expect(normalizeTitle("Fast & Furious")).toBe("fastandfurious");
  });
});

/** What TMDB's /search/tv returns for "Monster" (trimmed): the 2004 anime first, Netflix's anthology seasons as
 * separate shows with longer titles. */
const monsterSearch = [
  { tmdbID: 30981, title: "Monster", year: 2004 },
  { tmdbID: 113988, title: "Dahmer – Monster: The Jeffrey Dahmer Story", year: 2022 },
  { tmdbID: 225634, title: "Monsters: The Lyle and Erik Menendez Story", year: 2024 },
  { tmdbID: 286801, title: "Monster: The Ed Gein Story", year: 2025 },
  { tmdbID: 299939, title: "Monster: The Lizzie Borden Story", year: 2026 },
];
const seasons: Record<number, number> = { 30981: 1, 113988: 1, 225634: 1, 286801: 1, 299939: 1 };
const counts = async (id: number): Promise<number | undefined> => seasons[id];

/** A file name picked like the library does: its parsed title, year and season. */
async function pick(fileName: string, items = monsterSearch, count: (id: number) => Promise<number | undefined> = counts) {
  const p = parseReleaseName(fileName);
  return pickShow(items, p.title, p.year, p.season ?? 1, count);
}

describe("pickShow", () => {
  it("keeps the anthology's season 3 away from the one-season 2004 anime", async () => {
    expect(await pick("Monster.2022.S03E01.1080p.NF.WEB-DL.DDP5.1.Atmos.H.264-GP.mkv")).toBeUndefined();
    expect(await pick("Monster.S03E01.1080p.mkv")).toBeUndefined();
  });

  it("still matches the anime itself", async () => {
    expect(await pick("Monster.S01E05.1080p.BluRay.mkv")).toMatchObject({ item: { tmdbID: 30981 }, confidence: 1 });
  });

  it("matches the full title, and a year that fits one longer “Monster: …” title", async () => {
    expect(await pick("Monster.The.Ed.Gein.Story.S01E08.1080p.HEVC.x265-MeGusta.mkv")).toMatchObject({ item: { tmdbID: 286801 }, confidence: 1 });
    expect(await pick("Monster.2025.S01E02.1080p.mkv")).toMatchObject({ item: { tmdbID: 286801 }, confidence: 0.6 });
    expect(await pick("Monster.2026.S01E01.mkv")).toMatchObject({ item: { tmdbID: 299939 }, confidence: 0.6 });
  });

  it("needs the exact year and one candidate for a longer title", async () => {
    const two = [{ tmdbID: 30981, title: "Monster", year: 2004 }, { tmdbID: 1, title: "Monster: One", year: 2024 }, { tmdbID: 2, title: "Monster: Two", year: 2024 }];
    expect(await pick("Monster.2024.S02E01.mkv", two)).toBeUndefined();
    // 2025 is within a year of 2024 but not the year: not a guess either.
    expect(await pick("Monster.2025.S02E01.mkv", [two[0], two[1]])).toBeUndefined();
  });

  it("picks same-title shows by year", async () => {
    const who = [{ tmdbID: 1, title: "Doctor Who", year: 1963 }, { tmdbID: 2, title: "Doctor Who", year: 2005 }, { tmdbID: 3, title: "Doctor Who", year: 2023 }];
    expect((await pick("Doctor.Who.2005.S04E01.720p.mkv", who))?.item.tmdbID).toBe(2);
    expect((await pick("Doctor.Who.2023.S01E01.mkv", who))?.item.tmdbID).toBe(3);
    expect((await pick("Doctor.Who.S01E01.mkv", who))?.item.tmdbID).toBe(1);
  });

  it("takes a same-title show from another year when it has the season; an unknown count rules nothing out", async () => {
    expect(await pick("Severance.2025.S02E04.mkv", [{ tmdbID: 7, title: "Severance", year: 2022 }], async () => 2))
      .toMatchObject({ item: { tmdbID: 7 }, confidence: 0.6 });
    expect((await pick("Andor.S02E01.mkv", [{ tmdbID: 8, title: "Andor", year: 2022 }], async () => undefined))?.item.tmdbID).toBe(8);
    expect((await pick("Andor.S02E01.mkv", [{ tmdbID: 8, title: "Andor", year: 2022 }], async () => { throw new Error("TMDB 500"); }))?.item.tmdbID).toBe(8);
  });
});
