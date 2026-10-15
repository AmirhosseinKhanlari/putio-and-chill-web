import { describe, expect, it } from "vitest";
import type { Release } from "../api/sources/types";
import { parseReleaseName } from "./releaseName";
import { destination, displayPath, folderName, folderPath, pickRelease } from "./smartGet";

const GB = 1_000_000_000;
const release = (name: string, seeders: number | undefined, sizeBytes?: number): Release => ({ name, link: name, seeders, sizeBytes, sources: ["test"], parsed: parseReleaseName(name) });
const rule = (resolution: number | null, maxSizeGB: number | null = null) => ({ resolution, maxSizeGB });

describe("pickRelease", () => {
  const all = [
    release("Dune.Part.Two.2024.2160p.WEB-DL", 400, 30 * GB),
    release("Dune.Part.Two.2024.1080p.WEB-DL", 120, 6 * GB),
    release("Dune.Part.Two.2024.1080p.BluRay", 300, 14 * GB),
    release("Dune.Part.Two.2024.720p.WEB", 900, 2 * GB),
    release("Dune.Part.Two.2024.HDCAM", 5000),
  ];

  it("takes the preferred quality with the most seeders", () => {
    expect(pickRelease(all, rule(1080))?.name).toBe("Dune.Part.Two.2024.1080p.BluRay");
  });

  it("keeps under the size cap; unknown sizes are allowed", () => {
    expect(pickRelease(all, rule(1080, 10))?.name).toBe("Dune.Part.Two.2024.1080p.WEB-DL");
    expect(pickRelease(all, rule(2160, 10))?.name).toBe("Dune.Part.Two.2024.1080p.WEB-DL");
    expect(pickRelease([release("X.2024.1080p.WEB", 5)], rule(1080, 1))?.name).toBe("X.2024.1080p.WEB");
  });

  it("falls back to lower before higher, and never a camera copy", () => {
    expect(pickRelease(all.filter((r) => !r.name.includes("1080p")), rule(1080))?.name).toBe("Dune.Part.Two.2024.720p.WEB");
    expect(pickRelease([all[4], all[0]], rule(720))?.name).toBe("Dune.Part.Two.2024.2160p.WEB-DL");
  });

  it("Best takes the highest quality there is", () => {
    expect(pickRelease(all, rule(null))?.name).toBe("Dune.Part.Two.2024.2160p.WEB-DL");
  });

  it("never sends a dead release, but allows unknown seeders when nothing says", () => {
    expect(pickRelease([release("A.1080p", 0), release("B.720p", 3)], rule(1080))?.name).toBe("B.720p");
    expect(pickRelease([release("A.1080p", 0)], rule(1080))).toBeUndefined();
    expect(pickRelease([release("A.1080p", undefined)], rule(1080))?.name).toBe("A.1080p");
  });
});

describe("folders", () => {
  const defaults = { moviesFolder: null, tvFolder: null, seasonFolders: true };

  it("matches the iPhone app's default folders", () => {
    expect(folderPath("movie", "Dune: Part Two")).toEqual(["AMDB", "Movies"]);
    expect(folderPath("tv", "Severance", 2)).toEqual(["AMDB", "TV", "Severance", "Season 2"]);
    expect(folderName(" AC/DC ")).toBe("AC-DC");
  });

  it("uses the folders picked in Settings, by id", () => {
    const picked = { moviesFolder: { id: 11, path: "Media/Films" }, tvFolder: { id: 22, path: "Media/Shows" }, seasonFolders: false };
    expect(destination(picked, "movie", "Dune")).toEqual({ rootID: 11, path: [] });
    expect(destination(picked, "tv", "Severance", 2)).toEqual({ rootID: 22, path: ["Severance"] });
    expect(destination(defaults, "tv", "Severance", 2)).toEqual({ rootID: 0, path: ["AMDB", "TV", "Severance", "Season 2"] });
    expect(displayPath(picked, "tv", "Severance", 2)).toBe("Media/Shows/Severance");
    expect(displayPath(defaults, "tv", "Severance", 2)).toBe("AMDB/TV/Severance/Season 2");
    expect(displayPath(defaults, "movie", "Dune")).toBe("AMDB/Movies");
  });
});
