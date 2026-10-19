import { describe, expect, it } from "vitest";
import type { PutioFile } from "../api/putio";
import type { Release } from "../api/sources/types";
import { parseReleaseName } from "./releaseName";
import { defaultSettings, withoutOldFolderPicks } from "./settings";
import { destination, displayPath, ensureFolder, folderName, folderPath, pickRelease } from "./smartGet";

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

  it("matches the iPhone app's default folders: Movies and TV Series at the top of put.io", () => {
    expect(folderPath("movie", "Dune: Part Two")).toEqual(["Movies"]);
    expect(folderPath("tv", "Severance", 2)).toEqual(["TV Series", "Severance", "Season 2"]);
    expect(folderName(" AC/DC ")).toBe("AC-DC");
  });

  it("uses the folders picked in Settings, by id", () => {
    const picked = { moviesFolder: { id: 11, path: "Media/Films" }, tvFolder: { id: 22, path: "Media/Shows" }, seasonFolders: false };
    expect(destination(picked, "movie", "Dune")).toEqual({ rootID: 11, path: [] });
    expect(destination(picked, "tv", "Severance", 2)).toEqual({ rootID: 22, path: ["Severance"] });
    expect(destination(defaults, "tv", "Severance", 2)).toEqual({ rootID: 0, path: ["TV Series", "Severance", "Season 2"] });
    expect(displayPath(picked, "tv", "Severance", 2)).toBe("Media/Shows/Severance");
    expect(displayPath(defaults, "tv", "Severance", 2)).toBe("TV Series/Severance/Season 2");
    expect(displayPath({ ...defaults, seasonFolders: false }, "tv", "Severance", 2)).toBe("TV Series/Severance");
    expect(displayPath(defaults, "movie", "Dune")).toBe("Movies");
  });

  it("finds the user's own folders ignoring case instead of making new ones", async () => {
    const tree: Record<number, PutioFile[]> = { 0: [{ id: 5, name: "tv series ", file_type: "FOLDER" }, { id: 6, name: "Movies 4K", file_type: "FOLDER" }] };
    const created: string[] = [];
    let next = 100;
    const putio = {
      list: async (id: number) => ({ files: tree[id] ?? [] }),
      createFolder: async (name: string, parent: number) => {
        created.push(name);
        const folder = { id: next++, name, file_type: "FOLDER" };
        (tree[parent] ??= []).push(folder);
        return folder;
      },
    };
    const { rootID, path } = destination(defaults, "tv", "Severance", 2);
    const season = await ensureFolder(putio, rootID, path);
    expect(created).toEqual(["Severance", "Season 2"]);
    expect(tree[5].map((f) => f.name)).toEqual(["Severance"]);
    expect(season).toBe(101);
    await ensureFolder(putio, 0, ["Movies"]);
    expect(created.at(-1)).toBe("Movies"); // "Movies 4K" isn't "Movies"
  });

  it("sends a Settings pick of the old AMDB/Movies or AMDB/TV back to the default", () => {
    const old = { ...defaultSettings, moviesFolder: { id: 5, path: "AMDB/Movies" }, tvFolder: { id: 6, path: "amdb/TV" } };
    expect(withoutOldFolderPicks(old)).toMatchObject({ moviesFolder: null, tvFolder: null });
    const byID = { ...defaultSettings, moviesFolder: { id: 5, path: "Renamed" }, tvFolder: { id: 22, path: "Media/Shows" } };
    expect(withoutOldFolderPicks(byID, new Set([5]))).toMatchObject({ moviesFolder: null, tvFolder: { id: 22, path: "Media/Shows" } });
    const inside = { ...defaultSettings, moviesFolder: { id: 7, path: "AMDB/Movies/4K" } };
    expect(withoutOldFolderPicks(inside)).toBe(inside);
  });
});
