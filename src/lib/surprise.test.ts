import { describe, expect, it } from "vitest";
import type { CatalogItem } from "../api/tmdb";
import { choose, discoverQuery, initialSurprise, itemKey, moodByID, roll, type DiscoverPage } from "./surprise";

const movie = (id: number, backdrop = true): CatalogItem => ({ tmdbID: id, kind: "movie", title: `M${id}`, backdropPath: backdrop ? `/${id}.jpg` : null });
const pages = (byPage: Record<number, CatalogItem[]>, totalPages: number) => {
  const asked: number[] = [];
  const load = async (page: number): Promise<DiscoverPage> => {
    asked.push(page);
    return { items: byPage[page] ?? [], totalPages };
  };
  return { load, asked };
};
/** Always the first choice. */
const first = () => 0;

describe("discoverQuery", () => {
  it("asks for well-rated, well-voted titles, popular first", () => {
    expect(discoverQuery("movie", moodByID("anything"), 3)).toEqual({
      sort_by: "popularity.desc", "vote_average.gte": "6.5", "vote_count.gte": "500", page: "3",
    });
  });

  it("ORs the mood's genres, which differ for movies and TV", () => {
    expect(discoverQuery("movie", moodByID("thrill"), 1).with_genres).toBe("53|28");
    expect(discoverQuery("tv", moodByID("thrill"), 1).with_genres).toBe("10759|80");
    expect(discoverQuery("tv", moodByID("scare"), 1).with_genres).toBe("9648");
  });

  it("falls back to Anything for an unknown mood", () => {
    expect(moodByID("nope").id).toBe("anything");
    expect(moodByID(null).id).toBe("anything");
  });
});

describe("roll", () => {
  it("picks from a random page among the first ten", async () => {
    const { load, asked } = pages({ 1: [movie(1)], 8: [movie(80), movie(81)] }, 40);
    const state = await roll(initialSurprise, load, (n) => (n === 10 ? 7 : n - 1));
    expect(asked).toEqual([1, 8]);
    expect(state.pick?.tmdbID).toBe(81);
    expect(state.alternatives.map((i) => i.tmdbID)).toEqual([80]);
  });

  it("stays on page 1 when another page fails or is empty", async () => {
    const load = async (page: number): Promise<DiscoverPage> => {
      if (page > 1) throw new Error("TMDB 500");
      return { items: [movie(1)], totalPages: 5 };
    };
    expect((await roll(initialSurprise, load, (n) => n - 1)).pick?.tmdbID).toBe(1);
  });

  it("avoids recent picks while there are others", async () => {
    const { load } = pages({ 1: [movie(1), movie(2)] }, 1);
    const once = await roll(initialSurprise, load, first);
    const twice = await roll(once, load, first);
    expect([once.pick?.tmdbID, twice.pick?.tmdbID]).toEqual([1, 2]);
    // Everything was seen: repeats are allowed again.
    expect((await roll(twice, load, first)).pick).toBeDefined();
  });

  it("offers up to six alternatives with artwork, never the pick", async () => {
    const pool = [movie(1), movie(2, false), ...Array.from({ length: 10 }, (_, i) => movie(10 + i))];
    const { load } = pages({ 1: pool }, 1);
    const state = await roll(initialSurprise, load, first);
    expect(state.alternatives).toHaveLength(6);
    expect(state.alternatives.some((i) => i.tmdbID === 1 || i.tmdbID === 2)).toBe(false);
  });

  it("says when nothing matched", async () => {
    const { load } = pages({}, 0);
    const state = await roll(initialSurprise, load, first);
    expect(state.empty).toBe(true);
    expect(state.pick).toBeUndefined();
  });

  it("remembers only the last twenty picks", async () => {
    let state = initialSurprise;
    const { load } = pages({ 1: Array.from({ length: 30 }, (_, i) => movie(i)) }, 1);
    for (let i = 0; i < 25; i++) state = await roll(state, load, first);
    expect(state.recent).toHaveLength(20);
    expect(state.recent.at(-1)).toBe(itemKey(state.pick!));
  });
});

describe("choose", () => {
  it("swaps an alternative with the pick", async () => {
    const { load } = pages({ 1: [movie(1), movie(2), movie(3)] }, 1);
    const state = await roll(initialSurprise, load, first);
    const next = choose(state, state.alternatives[0]);
    expect(next.pick?.tmdbID).toBe(state.alternatives[0].tmdbID);
    expect(next.alternatives[0].tmdbID).toBe(1);
    expect(next.recent.at(-1)).toBe(itemKey(next.pick!));
  });

  it("ignores titles that aren't alternatives", async () => {
    const { load } = pages({ 1: [movie(1), movie(2)] }, 1);
    const state = await roll(initialSurprise, load, first);
    expect(choose(state, movie(99))).toBe(state);
  });
});
