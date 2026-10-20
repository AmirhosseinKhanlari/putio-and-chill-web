import { describe, expect, it } from "vitest";
import { noQueryMessage, noVersionsMessage, releaseQuery } from "./releaseQuery";

const edGein = { tmdbID: 286801, kind: "tv" as const, title: "Monster: The Ed Gein Story", year: 2025 };

describe("releaseQuery", () => {
  it("builds episode, season and movie queries without an IMDb id", () => {
    expect(releaseQuery({ item: edGein, season: 1, episode: 1 })).toEqual({ kind: "episode", title: edGein.title, imdbID: undefined, season: 1, episode: 1 });
    expect(releaseQuery({ item: edGein, season: 1 })).toEqual({ kind: "season", title: edGein.title, imdbID: undefined, season: 1 });
    expect(releaseQuery({ item: { tmdbID: 1, kind: "movie", title: "Heat", year: 1995 } })).toEqual({ kind: "movie", title: "Heat", year: 1995, imdbID: undefined });
  });

  it("keeps a real IMDb id and treats an empty one as none", () => {
    expect(releaseQuery({ item: edGein, imdbID: "tt1", season: 1, episode: 2 })).toMatchObject({ imdbID: "tt1" });
    expect(releaseQuery({ item: edGein, imdbID: "", season: 1 })).toMatchObject({ imdbID: undefined });
  });

  it("needs a title, and a season for shows, and says why", () => {
    const loading = { item: { ...edGein, title: "" }, season: 1 };
    expect(releaseQuery(loading)).toBeUndefined();
    expect(noQueryMessage(loading)).toBe("Still loading this title. Try again in a moment.");
    expect(releaseQuery({ item: edGein })).toBeUndefined();
    expect(noQueryMessage({ item: edGein })).toBe("Pick a season or an episode to search for.");
  });
});

describe("noVersionsMessage", () => {
  it("says it searched by name when there's no IMDb id, and which sources failed", () => {
    const query = releaseQuery({ item: edGein, season: 1, episode: 1 });
    expect(noVersionsMessage(query, [{ source: "knaben", message: "Knaben couldn't be reached." }])).toBe(
      "No versions found. This title has no IMDb id yet, so sources were searched by name (“Monster The Ed Gein Story S01E01”). " +
      "Knaben couldn't be reached. Try again later, or turn on more sources in Settings.",
    );
    expect(noVersionsMessage({ kind: "episode", title: "Severance", imdbID: "tt11280740", season: 2, episode: 4 }))
      .toBe("No versions found. Try again later, or turn on more sources in Settings.");
  });
});
