import { describe, expect, it } from "vitest";
import type { Episode } from "../api/tmdb";
import type { LibraryEntry } from "./library";
import { upNextAfter, upNextLabel, type SeasonLookup } from "./upNext";

const TODAY = "2026-10-26";
const file = (season: number, episode: number): LibraryEntry => ({
  id: season * 100 + episode, name: `Show.S${season}E${episode}.mkv`, startFrom: 0,
  match: { tmdbID: 1, kind: "tv", title: "Show", season, episode },
});
const tmdbSeason = (count: number, airDate = "2026-01-01", names = true): Episode[] =>
  Array.from({ length: count }, (_, i) => ({ number: i + 1, name: names ? `Episode ${i + 1}` : "", airDate }));
const seasons = (map: Record<number, Episode[] | null>): SeasonLookup => (season) => (season in map ? map[season] : null);

describe("upNextAfter", () => {
  it("the same season's next episode, playing its file when it's in put.io", () => {
    const files = [file(2, 4), file(2, 5)];
    expect(upNextAfter({ season: 2, episode: 4 }, files, seasons({ 2: tmdbSeason(8) }), TODAY))
      .toEqual({ next: { season: 2, episode: 5, name: "Episode 5", entry: files[1] } });
  });

  it("after a season's last episode, the next season's first (not in put.io yet)", () => {
    const result = upNextAfter({ season: 2, episode: 8 }, [file(2, 8)], seasons({ 2: tmdbSeason(8), 3: tmdbSeason(10) }), TODAY);
    expect(result).toEqual({ next: { season: 3, episode: 1, name: "Episode 1", entry: undefined } });
  });

  it("nothing after the show's last episode", () => {
    expect(upNextAfter({ season: 3, episode: 10 }, [file(3, 10)], seasons({ 3: tmdbSeason(10) }), TODAY)).toEqual({ next: undefined });
  });

  it("nothing while the next episode hasn't aired (in the same season, or a new one)", () => {
    const s2 = [...tmdbSeason(8), { number: 9, name: "Soon", airDate: "2026-11-02" }];
    expect(upNextAfter({ season: 2, episode: 8 }, [], seasons({ 2: s2, 3: tmdbSeason(10) }), TODAY)).toEqual({ next: undefined });
    expect(upNextAfter({ season: 2, episode: 8 }, [], seasons({ 2: tmdbSeason(8), 3: tmdbSeason(10, "2027-01-15") }), TODAY)).toEqual({ next: undefined });
    // No air date yet counts as not aired.
    expect(upNextAfter({ season: 2, episode: 8 }, [], seasons({ 2: tmdbSeason(8), 3: [{ number: 1, name: "TBA" }] }), TODAY)).toEqual({ next: undefined });
    // Aired today counts.
    expect(upNextAfter({ season: 2, episode: 8 }, [], seasons({ 2: tmdbSeason(8), 3: tmdbSeason(10, TODAY) }), TODAY))
      .toMatchObject({ next: { season: 3, episode: 1 } });
  });

  it("an episode in put.io is offered even when TMDB doesn't know it aired", () => {
    const files = [file(2, 5)];
    expect(upNextAfter({ season: 2, episode: 4 }, files, seasons({ 2: tmdbSeason(8, "2027-01-01") }), TODAY))
      .toMatchObject({ next: { season: 2, episode: 5, entry: files[0] } });
  });

  it("falls back to the library's files when TMDB fails", () => {
    const files = [file(2, 4), file(2, 6), file(3, 1)];
    expect(upNextAfter({ season: 2, episode: 4 }, files, seasons({}), TODAY)).toEqual({ next: { season: 2, episode: 6, entry: files[1] } });
    expect(upNextAfter({ season: 2, episode: 6 }, files, seasons({}), TODAY)).toEqual({ next: { season: 3, episode: 1, entry: files[2] } });
    expect(upNextAfter({ season: 3, episode: 1 }, files, seasons({}), TODAY)).toEqual({ next: undefined });
  });

  it("uses a file TMDB doesn't list yet", () => {
    const files = [file(2, 5)];
    expect(upNextAfter({ season: 2, episode: 4 }, files, seasons({ 2: tmdbSeason(4) }), TODAY))
      .toEqual({ next: { season: 2, episode: 5, entry: files[0] } });
  });

  it("waits for a season TMDB is still loading, asking for the next season only when needed", () => {
    const loading: SeasonLookup = () => undefined;
    expect(upNextAfter({ season: 2, episode: 4 }, [], loading, TODAY)).toEqual({ loading: 2 });
    expect(upNextAfter({ season: 2, episode: 8 }, [], (s) => (s === 2 ? tmdbSeason(8) : undefined), TODAY)).toEqual({ loading: 3 });
  });

  it("never comes up after a special", () => {
    expect(upNextAfter({ season: 0, episode: 2 }, [file(1, 1)], seasons({ 0: tmdbSeason(5), 1: tmdbSeason(5) }), TODAY)).toEqual({ next: undefined });
  });
});

describe("upNextLabel", () => {
  it("says which episode, with its name, or that it isn't in put.io", () => {
    expect(upNextLabel({ season: 2, episode: 5, name: "Woe's Hollow", entry: file(2, 5) })).toBe("Up Next · S2 E5 · Woe's Hollow");
    expect(upNextLabel({ season: 2, episode: 5, entry: file(2, 5) })).toBe("Up Next · S2 E5");
    expect(upNextLabel({ season: 3, episode: 1, name: "Hello" })).toBe("Up Next · S3 E1 · Not in put.io");
  });
});
