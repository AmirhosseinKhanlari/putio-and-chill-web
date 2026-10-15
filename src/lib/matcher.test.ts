import { describe, expect, it } from "vitest";
import { normalizeTitle, pickMatch } from "./matcher";

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
