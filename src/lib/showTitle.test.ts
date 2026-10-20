import { describe, expect, it } from "vitest";
import { sameShow, searchTitle, titleWords } from "./showTitle";

describe("searchTitle", () => {
  it("drops punctuation, joins apostrophes and spells out &", () => {
    expect(searchTitle("Monster: The Ed Gein Story")).toBe("Monster The Ed Gein Story");
    expect(searchTitle("Grey's Anatomy")).toBe("Greys Anatomy");
    expect(searchTitle("Law & Order: SVU")).toBe("Law and Order SVU");
    expect(searchTitle("  Dahmer – Monster  ")).toBe("Dahmer Monster");
    expect(searchTitle("Shōgun")).toBe("Shōgun");
  });
});

describe("sameShow", () => {
  it("ignores case, accents, punctuation, & and a leading article", () => {
    expect(sameShow("The Last of Us", "The Last of Us")).toBe(true);
    expect(sameShow("Last of Us", "The Last of Us")).toBe(true);
    expect(sameShow("Shogun", "Shōgun")).toBe(true);
    expect(sameShow("Law and Order", "Law & Order")).toBe(true);
    expect(sameShow("Monster The Ed Gein Story", "Monster: The Ed Gein Story")).toBe(true);
  });

  it("allows one extra year or country word", () => {
    expect(sameShow("The Office US", "The Office")).toBe(true);
    expect(sameShow("Doctor Who 2005", "Doctor Who")).toBe(true);
    expect(sameShow("Doctor Who 1850", "Doctor Who")).toBe(false);
    expect(sameShow("The Office Christmas Special", "The Office")).toBe(false);
  });

  it("tells shows apart", () => {
    expect(sameShow("Monster", "Monster: The Ed Gein Story")).toBe(false);
    expect(sameShow("Monster The Ed Gein Story", "Monster")).toBe(false);
    expect(sameShow("Wednesday", "Monster: The Ed Gein Story")).toBe(false);
  });

  it("drops a site prefix and passes when a side has no words", () => {
    expect(sameShow("www.UIndex.org - Severance", "Severance")).toBe(true);
    expect(sameShow("www.UIndex.org - Severance", "Monster")).toBe(false);
    expect(sameShow("", "Severance")).toBe(true);
    expect(titleWords("The")).toEqual(["the"]);
  });
});
