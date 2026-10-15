import { beforeEach, describe, expect, it } from "vitest";
import type { PutioSubtitle } from "../../api/putio";
import { creditsLength, nextUpCardState } from "./nextUp";
import {
  audioLabels, bestAudioIndex, bestTrack, cachedSubtitle, cacheSubtitle, decodeCueText, groupTracks, normalizeLanguage,
  parseSubtitles, parseTime, savedChoice, saveChoice, srtToVtt, toWebVTT, trackTags,
} from "./subtitles";

beforeEach(() => {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

const SRT = "﻿1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Hello</i> there\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\n{\\an8}Tom & Jerry <b>2</b>\r\nSecond line\r\n\r\n3\r\nbroken --> nope\r\nskip me\r\n";

describe("parsing", () => {
  it("reads SRT times with commas, VTT times without hours, and cue settings", () => {
    expect(parseTime("01:02:03,456")).toBeCloseTo(3723.456);
    expect(parseTime("02:03.5 align:start")).toBeCloseTo(123.5);
    expect(parseTime("abc")).toBeUndefined();
  });

  it("reads SRT into clean cues and skips broken blocks", () => {
    expect(parseSubtitles(SRT)).toEqual([
      { start: 1, end: 3.5, text: "Hello there" },
      { start: 4, end: 5, text: "Tom & Jerry 2\nSecond line" },
    ]);
  });

  it("reads WebVTT with a header, ids and escapes", () => {
    const vtt = "WEBVTT\n\nNOTE made by hand\n\nintro\n00:01.000 --> 00:02.000 line:90%\nA &lt;b&gt; &amp; c\n";
    expect(parseSubtitles(vtt)).toEqual([{ start: 1, end: 2, text: "A <b> & c" }]);
  });

  it("turns SRT into WebVTT that reads back the same, with the timing shift", () => {
    const vtt = srtToVtt(SRT);
    expect(vtt.startsWith("WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHello there")).toBe(true);
    expect(vtt).toContain("Tom &amp; Jerry 2\nSecond line");
    expect(parseSubtitles(vtt)).toEqual(parseSubtitles(SRT));
    const later = toWebVTT(parseSubtitles(SRT), 1.5);
    expect(parseSubtitles(later)[0]).toEqual({ start: 2.5, end: 5, text: "Hello there" });
    // Shifted before the start: cues that end before 0 go, the rest start at 0.
    expect(parseSubtitles(toWebVTT(parseSubtitles(SRT), -4))).toEqual([{ start: 0, end: 1, text: "Tom & Jerry 2\nSecond line" }]);
  });

  it("decodes what the overlay gets from a cue", () => {
    expect(decodeCueText("<i>Hi</i> &amp; bye")).toBe("Hi & bye");
  });
});

describe("put.io tracks", () => {
  const tracks: PutioSubtitle[] = [
    { key: "a", language: "English", language_code: "eng", name: "English", source: "mkv" },
    { key: "b", language: "English", language_code: "eng", name: "English", source: "mkv" },
    { key: "c", language: "English", language_code: "eng", name: "English (Forced)", source: "mkv" },
    { key: "d", language: "Undetermined", language_code: "und", name: "Undetermined", source: "mkv" },
    { key: "e", language: "English", language_code: "eng", name: "Show.S01E01.1080p.en.srt", source: "folder" },
    { key: "f", language: "English", language_code: "eng", name: "Show.S01E01.WEB.x264-GROUP", source: "opensubtitles" },
  ];

  it("groups by origin and tells identical tracks apart", () => {
    const groups = groupTracks(tracks);
    expect(groups.map((g) => g.title)).toEqual(["In the video file", "Files next to the video", "Found by put.io"]);
    const inside = groups[0].rows.map((r) => [r.title, r.detail, r.tags]);
    expect(inside).toEqual([
      ["English", "Track 1", []],
      ["English", "Track 2", []],
      ["English", "English (Forced)", ["Forced"]],
      ["Unknown language", "", []],
    ]);
    expect(groups[1].rows[0].detail).toBe("Show.S01E01.1080p.en.srt");
    expect(groups[2].rows[0].detail).toBe("Show.S01E01.WEB.x264-GROUP");
  });

  it("picks the preferred language inside the file first, never a forced track over a full one", () => {
    expect(bestTrack(tracks, "en")?.key).toBe("a");
    expect(bestTrack(tracks.filter((t) => t.key === "c" || t.key === "e"), "en")?.key).toBe("e");
    expect(bestTrack(tracks, "fr")).toBeUndefined();
    expect(bestTrack([{ key: "x", language: "French" }], "fr")?.key).toBe("x");
  });

  it("spots SDH and forced tracks by name", () => {
    expect(trackTags("Movie.2020.en.hi.srt")).toEqual(["SDH"]);
    expect(trackTags("English SDH")).toEqual(["SDH"]);
    expect(trackTags("Forced")).toEqual(["Forced"]);
    expect(trackTags("English")).toEqual([]);
  });
});

describe("languages and audio", () => {
  it("normalizes 2- and 3-letter tags", () => {
    expect(["eng", "en-US", "pt_BR", "pob", "ger", "und", ""].map(normalizeLanguage)).toEqual(["en", "en", "pt", "pt", "de", "", ""]);
  });

  it("finds the preferred audio track", () => {
    expect(bestAudioIndex(["jpn", "eng"], "en")).toBe(1);
    expect(bestAudioIndex(["jpn", "eng"], null)).toBeUndefined();
    expect(bestAudioIndex([undefined, "jpn"], "fr")).toBeUndefined();
  });

  it("names audio tracks so each is distinct", () => {
    expect(audioLabels([
      { name: "English", lang: "en", channels: "6" },
      { name: "Commentary", lang: "en", channels: "2" },
      { name: "audio 1", lang: "ja" },
      { name: "audio 2", lang: "ja" },
      { name: "", lang: "" },
    ])).toEqual(["English · 5.1", "English · Commentary · Stereo", "Japanese (1)", "Japanese (2)", "Track 5"]);
  });
});

describe("remembering", () => {
  it("keeps the pick per file and downloaded files", () => {
    expect(savedChoice(7)).toBeUndefined();
    saveChoice(7, { source: "putio", key: "a", label: "English", language: "en", offset: 0.5 });
    expect(savedChoice(7)).toMatchObject({ source: "putio", key: "a", offset: 0.5 });
    cacheSubtitle(42, "text");
    expect(cachedSubtitle(42)).toBe("text");
    for (let i = 0; i < 30; i++) cacheSubtitle(100 + i, "x");
    expect(cachedSubtitle(42)).toBeNull();
    expect(cachedSubtitle(129)).toBe("x");
  });
});

describe("next episode timing", () => {
  it("assumes credits of 2.5% of the running time, 20 to 60 seconds", () => {
    expect(creditsLength(1320)).toBe(33);
    expect(creditsLength(600)).toBe(20);
    expect(creditsLength(4000)).toBe(60);
    expect(creditsLength(Number.NaN)).toBe(0);
  });

  it("shows the card in the credits and at the end, and hides it after Watch Credits until the end", () => {
    expect(nextUpCardState(1200, 1320, false, false)).toBe("hidden");
    expect(nextUpCardState(1290, 1320, false, false)).toBe("credits");
    expect(nextUpCardState(1290, 1320, false, true)).toBe("hidden");
    expect(nextUpCardState(1319, 1320, false, true)).toBe("end");
    expect(nextUpCardState(100, 1320, true, false)).toBe("end");
    expect(nextUpCardState(0, 0, false, false)).toBe("hidden");
  });
});
