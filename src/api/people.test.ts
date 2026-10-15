import { describe, expect, it } from "vitest";
import { longDate, parsePerson, personMeta, type RawPerson } from "./people";

const nolan: RawPerson = {
  id: 525, name: "Christopher Nolan", biography: "British-American filmmaker.\n", profile_path: "/n.jpg",
  known_for_department: "Directing", birthday: "1970-07-30", place_of_birth: "London", deathday: null,
  combined_credits: {
    cast: [
      { id: 1, media_type: "movie", title: "Cameo", release_date: "2001-01-01", character: "Man", vote_count: 5 },
      { id: 50, media_type: "tv", name: "Late Night", first_air_date: "2014-02-17", character: "Self", vote_count: 90000, genre_ids: [10767] },
    ],
    crew: [
      { id: 27205, media_type: "movie", title: "Inception", release_date: "2010-07-15", job: "Director", vote_count: 38000 },
      { id: 27205, media_type: "movie", title: "Inception", release_date: "2010-07-15", job: "Writer", vote_count: 38000 },
      { id: 872585, media_type: "movie", title: "Oppenheimer", release_date: "2023-07-19", job: "Director", vote_count: 9000 },
      { id: 9, media_type: "movie", title: "Untitled", release_date: "", job: "Producer", vote_count: 0 },
    ],
  },
};

describe("parsePerson", () => {
  const person = parsePerson(nolan);

  it("lists each title once, newest first, undated last", () => {
    expect(person.credits.map((c) => c.item.tmdbID)).toEqual([872585, 50, 27205, 1, 9]);
  });

  it("keeps every role on a title", () => {
    expect(person.credits.find((c) => c.item.tmdbID === 27205)?.roles).toEqual(["Director", "Writer"]);
    expect(person.credits.find((c) => c.item.tmdbID === 50)?.item.kind).toBe("tv");
  });

  it("puts the most-voted titles in Known For, leaving out talk shows", () => {
    expect(person.knownFor.map((i) => i.tmdbID)).toEqual([27205, 872585, 1, 9]);
  });

  it("reads the profile", () => {
    expect(person).toMatchObject({ name: "Christopher Nolan", biography: "British-American filmmaker.", department: "Directing", deathday: undefined });
  });

  it("copes with no credits", () => {
    expect(parsePerson({ id: 1, name: "Nobody" })).toMatchObject({ credits: [], knownFor: [], biography: "" });
  });
});

describe("personMeta", () => {
  it("joins department, birthday and place", () => {
    expect(personMeta(parsePerson(nolan))).toBe("Directing · Born July 30, 1970 · London");
  });

  it("adds the date of death and skips what's missing", () => {
    expect(personMeta({ birthday: "1930-08-25", deathday: "2020-10-31" })).toBe("Born August 25, 1930 · Died October 31, 2020");
    expect(longDate("1970")).toBeUndefined();
  });
});
