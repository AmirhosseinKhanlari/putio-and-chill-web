import { describe, expect, it } from "vitest";
import type { Release } from "../api/chill";
import { parseReleaseName } from "./releaseName";
import { folderPath, pickRelease } from "./smartGet";

const release = (name: string, seeders: number): Release => ({ name, link: name, seeders, source: "test", parsed: parseReleaseName(name) });

describe("pickRelease", () => {
  const all = [
    release("Dune.Part.Two.2024.2160p.WEB-DL", 400),
    release("Dune.Part.Two.2024.1080p.WEB-DL", 120),
    release("Dune.Part.Two.2024.1080p.BluRay", 300),
    release("Dune.Part.Two.2024.720p.WEB", 900),
    release("Dune.Part.Two.2024.HDCAM", 5000),
  ];

  it("takes the preferred quality with the most seeders", () => {
    expect(pickRelease(all, 1080)?.name).toBe("Dune.Part.Two.2024.1080p.BluRay");
  });

  it("falls back to lower before higher, and never a camera copy", () => {
    expect(pickRelease(all.filter((r) => !r.name.includes("1080p")), 1080)?.name).toBe("Dune.Part.Two.2024.720p.WEB");
    expect(pickRelease([all[4], all[0]], 720)?.name).toBe("Dune.Part.Two.2024.2160p.WEB-DL");
  });

  it("prefers seeded releases", () => {
    expect(pickRelease([release("A.1080p", 0), release("B.720p", 3)], 1080)?.name).toBe("B.720p");
  });
});

describe("folderPath", () => {
  it("matches the iPhone app's folders", () => {
    expect(folderPath("movie", "Dune: Part Two")).toEqual(["AMDB", "Movies"]);
    expect(folderPath("tv", "Severance", 2)).toEqual(["AMDB", "TV", "Severance", "Season 2"]);
  });
});
