import { describe, expect, it } from "vitest";
import { parseReleaseName } from "./releaseName";

describe("parseReleaseName", () => {
  it("reads an episode", () => {
    const r = parseReleaseName("Severance.S02E04.1080p.WEB.H264-NTb.mkv");
    expect(r).toMatchObject({ title: "Severance", season: 2, episode: 4, resolution: 1080, source: "WEB", codec: "H.264", group: "NTb" });
  });

  it("reads a movie with its year", () => {
    const r = parseReleaseName("Interstellar.2014.1080p.BluRay.x264.mkv");
    expect(r).toMatchObject({ title: "Interstellar", year: 2014, resolution: 1080, source: "BluRay", codec: "H.264" });
    expect(r.season).toBeUndefined();
  });

  it("keeps a year that is part of the title", () => {
    expect(parseReleaseName("Blade.Runner.2049.2017.2160p.UHD.BluRay.mkv")).toMatchObject({ title: "Blade Runner 2049", year: 2017, resolution: 2160 });
  });

  it("reads a season pack and flags", () => {
    expect(parseReleaseName("The.Bear.S03.COMPLETE.720p.HDTV.x265-GRP")).toMatchObject({
      title: "The Bear", season: 3, resolution: 720, isComplete: true, codec: "H.265",
    });
  });

  it("strips a leading site tag and keeps spaced titles", () => {
    expect(parseReleaseName("[site] Past Lives (2023) 1080p WEB-DL")).toMatchObject({ title: "Past Lives", year: 2023, source: "WEB-DL" });
  });
});
