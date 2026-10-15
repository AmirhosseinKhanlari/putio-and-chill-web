/** Subtitle text and track logic for the player (ports of the iPhone app's SubtitleParser, LanguageMatcher and
 * SubtitleFinder.bestTrack). Pure functions, so they can be tested without a video. */
import type { PutioSubtitle } from "../../api/putio";
import { readJSON, readString, writeJSON, writeString } from "../../lib/storage";

export interface Cue {
  start: number;
  end: number;
  text: string;
}

// MARK: Parsing and WebVTT

const TAGS = /<[^>]+>|\{\\[^}]*\}/g;

/** "01:02:03,456", "01:02:03.456" or "02:03.456" (VTT may drop the hours and add cue settings after the time). */
export function parseTime(raw: string): number | undefined {
  const token = raw.trim().split(/\s+/)[0] ?? "";
  const fields = token.replace(",", ".").split(":");
  if (fields.length < 2 || fields.length > 3) return undefined;
  let seconds = 0;
  for (const field of fields) {
    if (!/^\d+(\.\d+)?$/.test(field)) return undefined;
    seconds = seconds * 60 + Number(field);
  }
  return seconds;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&lrm;": "‎", "&rlm;": "‏", "&quot;": "\"", "&#39;": "'" };

/** WebVTT cue text as plain text (the escapes `toWebVTT` writes, and the ones put.io's files use). */
export function decodeCueText(text: string): string {
  return text.replace(TAGS, "").replace(/&(amp|lt|gt|nbsp|lrm|rlm|quot|#39);/g, (m) => ENTITIES[m] ?? m);
}

/** SRT or WebVTT into cues, without styling tags (<i>, <font …>, {\an8}); broken blocks are skipped. */
export function parseSubtitles(raw: string): Cue[] {
  const normalized = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const cues: Cue[] = [];
  for (const block of normalized.split(/\n[ \t]*\n/)) {
    const lines = block.split("\n");
    const timing = lines.findIndex((l) => l.includes("-->"));
    if (timing < 0) continue;
    const [a, b] = lines[timing].split("-->");
    const start = parseTime(a);
    const end = b === undefined ? undefined : parseTime(b);
    if (start === undefined || end === undefined || end <= start) continue;
    const text = lines.slice(timing + 1)
      .map((l) => decodeCueText(l).trim())
      .filter(Boolean)
      .join("\n");
    if (text) cues.push({ start, end, text });
  }
  return cues.sort((x, y) => x.start - y.start);
}

function vttTime(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

const escapeCue = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Cues as a WebVTT file, shifted by `offset` seconds (positive shows them later), for the video's <track>. */
export function toWebVTT(cues: Cue[], offset = 0): string {
  const body = cues
    .map((c) => ({ ...c, start: c.start + offset, end: c.end + offset }))
    .filter((c) => c.end > 0)
    .map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${escapeCue(c.text)}`);
  return `WEBVTT\n\n${body.join("\n\n")}\n`;
}

export const srtToVtt = (srt: string, offset = 0) => toWebVTT(parseSubtitles(srt), offset);

// MARK: Languages

/** ISO 639-2 codes (both forms) and OpenSubtitles' own codes, to ISO 639-1. */
const THREE_LETTER: Record<string, string> = {
  eng: "en", spa: "es", fra: "fr", fre: "fr", deu: "de", ger: "de", ita: "it", por: "pt", pob: "pt", nld: "nl", dut: "nl",
  swe: "sv", nor: "no", nob: "no", nno: "no", dan: "da", fin: "fi", pol: "pl", ces: "cs", cze: "cs", slk: "sk", slo: "sk",
  hun: "hu", ron: "ro", rum: "ro", ell: "el", gre: "el", tur: "tr", rus: "ru", ukr: "uk", ara: "ar", heb: "he", fas: "fa",
  per: "fa", hin: "hi", zho: "zh", chi: "zh", jpn: "ja", kor: "ko", vie: "vi", tha: "th", ind: "id", msa: "ms", may: "ms",
  bul: "bg", hrv: "hr", srp: "sr", slv: "sl", est: "et", lav: "lv", lit: "lt", cat: "ca", eus: "eu", baq: "eu", glg: "gl",
  isl: "is", ice: "is", ben: "bn", tam: "ta", tel: "te", urd: "ur", mkd: "mk", mac: "mk", sqi: "sq", alb: "sq", hye: "hy",
  arm: "hy", kat: "ka", geo: "ka", cym: "cy", wel: "cy", fil: "tl", tgl: "tl", und: "", zxx: "", mul: "",
};

/** "eng", "en-US", "pt_BR", "pob" → "en", "en", "pt", "pt"; unknown or undetermined → "". */
export function normalizeLanguage(tag?: string | null): string {
  const base = (tag ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  if (base.length === 3) return THREE_LETTER[base] ?? base;
  return base;
}

const names = (() => {
  try { return new Intl.DisplayNames(["en"], { type: "language" }); } catch { return undefined; }
})();

/** "en" → "English"; empty or undetermined → "". */
export function languageName(code?: string | null): string {
  const normalized = normalizeLanguage(code);
  if (!normalized) return "";
  try { return names?.of(normalized) ?? normalized; } catch { return normalized; }
}

/** Languages offered for OpenSubtitles searches. */
export const SEARCH_LANGUAGES = ["en", "es", "fr", "de", "it", "pt-pt", "pt-br", "nl", "sv", "no", "da", "fi", "pl", "cs", "hu", "ro",
  "el", "tr", "ru", "uk", "ar", "he", "fa", "hi", "zh-cn", "zh-tw", "ja", "ko", "vi", "th", "id", "ms", "bg", "hr", "sr", "sk", "sl"]
  .map((code) => ({ code, name: code === "pt-pt" ? "Portuguese" : code === "pt-br" ? "Portuguese (Brazil)" : code === "zh-tw" ? "Chinese (Traditional)" : code === "zh-cn" ? "Chinese (Simplified)" : languageName(code) }));

// MARK: put.io's tracks

/** How put.io found a track: inside the video, a file in its folder, or its own OpenSubtitles fetch. */
export type TrackOrigin = "inside" | "folder" | "putio";

export const ORIGIN_TITLES: Record<TrackOrigin, string> = {
  inside: "In the video file",
  folder: "Files next to the video",
  putio: "Found by put.io",
};

export function trackOrigin(track: PutioSubtitle): TrackOrigin {
  const source = (track.source ?? "").toLowerCase();
  if (source === "mkv" || source === "embedded" || source === "internal") return "inside";
  if (source === "folder" || source === "file") return "folder";
  return "putio";
}

export interface TrackRow {
  track: PutioSubtitle;
  /** "English", or "Unknown language" when put.io doesn't know ("Undetermined"). */
  title: string;
  /** What tells it apart from the others: its file or track name, and a number when even that is the same. */
  detail: string;
  tags: string[];
}

const UNDETERMINED = /^(undetermined|unknown|und)$/i;

function trackLanguage(track: PutioSubtitle): string {
  const fromCode = languageName(track.language_code);
  if (fromCode) return fromCode;
  if (track.language && !UNDETERMINED.test(track.language.trim())) return track.language.trim();
  return "Unknown language";
}

/** Forced tracks only carry the foreign-language bits; SDH ones add sound descriptions. */
export function trackTags(name?: string): string[] {
  const tags: string[] = [];
  if (!name) return tags;
  if (/\bforced\b/i.test(name)) tags.push("Forced");
  if (/\b(sdh|cc|hi|hearing[ ._-]?impaired)\b/i.test(name)) tags.push("SDH");
  return tags;
}

/** put.io's tracks grouped by origin (inside the file first), each with a label that tells it apart. */
export function groupTracks(tracks: PutioSubtitle[]): { origin: TrackOrigin; title: string; rows: TrackRow[] }[] {
  const order: TrackOrigin[] = ["inside", "folder", "putio"];
  const rows = tracks.map((track) => {
    const title = trackLanguage(track);
    const name = track.name?.trim() ?? "";
    const detail = name && name.toLowerCase() !== title.toLowerCase() && !UNDETERMINED.test(name) ? name : "";
    return { track, title, detail, tags: trackTags(name) };
  });
  // Still identical (ten "English" tracks inside one MKV): number them in the order put.io lists them.
  const counts = new Map<string, number>();
  for (const r of rows) {
    const id = `${trackOrigin(r.track)}|${r.title}|${r.detail}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const r of rows) {
    const id = `${trackOrigin(r.track)}|${r.title}|${r.detail}`;
    if ((counts.get(id) ?? 0) < 2) continue;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    r.detail = r.detail ? `${r.detail} · Track ${n}` : `Track ${n}`;
  }
  return order
    .map((origin) => ({ origin, title: ORIGIN_TITLES[origin], rows: rows.filter((r) => trackOrigin(r.track) === origin) }))
    .filter((g) => g.rows.length);
}

/** The track in `language`: inside the file first, then files next to it, then put.io's fetches; forced tracks last. */
export function bestTrack(tracks: PutioSubtitle[], language: string): PutioSubtitle | undefined {
  const wanted = normalizeLanguage(language);
  if (!wanted) return undefined;
  const wantedName = languageName(wanted).toLowerCase();
  const rank = { inside: 0, folder: 1, putio: 2 } as const;
  const score = (t: PutioSubtitle) => rank[trackOrigin(t)] + (trackTags(t.name).includes("Forced") ? 10 : 0);
  return tracks
    .filter((t) => normalizeLanguage(t.language_code) === wanted || (t.language ?? "").trim().toLowerCase() === wantedName)
    .reduce<PutioSubtitle | undefined>((best, t) => (best === undefined || score(t) < score(best) ? t : best), undefined);
}

/** Index of the audio track in `language`, if any (hls.js and Safari give 2- or 3-letter tags). */
export function bestAudioIndex(languages: (string | undefined)[], language: string | null): number | undefined {
  if (!language) return undefined;
  const wanted = normalizeLanguage(language);
  const index = languages.findIndex((l) => normalizeLanguage(l) === wanted);
  return index < 0 ? undefined : index;
}

const CHANNELS: Record<string, string> = { "1": "Mono", "2": "Stereo", "6": "5.1", "8": "7.1" };

/** Names for the audio menu: the language, plus the track's own name or channels when that tells two apart. */
export function audioLabels(tracks: { name?: string; lang?: string; channels?: string }[]): string[] {
  const labels = tracks.map((t, i) => {
    const language = languageName(t.lang);
    const name = (t.name ?? "").trim();
    const nameAdds = name && name.toLowerCase() !== language.toLowerCase() && normalizeLanguage(name) !== normalizeLanguage(t.lang) && !/^(audio|track)?\s*\d*$/i.test(name);
    const channels = t.channels ? CHANNELS[t.channels.split("/")[0]] : undefined;
    const title = language || (nameAdds ? name : "") || `Track ${i + 1}`;
    return [title, language && nameAdds ? name : "", channels].filter(Boolean).join(" · ");
  });
  const counts = new Map<string, number>();
  labels.forEach((l) => counts.set(l, (counts.get(l) ?? 0) + 1));
  const seen = new Map<string, number>();
  return labels.map((l) => {
    if ((counts.get(l) ?? 0) < 2) return l;
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return `${l} (${n})`;
  });
}

// MARK: Remembering picks (per put.io file, like the iPhone app)

export type SubtitleChoice =
  | { source: "off" }
  | { source: "putio"; key: string; label: string; language: string; offset: number }
  | { source: "opensubtitles"; fileID: number; label: string; language: string; offset: number };

const CHOICES = "pc.subtitle-choices.v1";
const MAX_CHOICES = 300;

export function savedChoice(fileID: number): SubtitleChoice | undefined {
  return readJSON<Record<string, SubtitleChoice>>(CHOICES, {})[fileID];
}

export function saveChoice(fileID: number, choice: SubtitleChoice) {
  const all = readJSON<Record<string, SubtitleChoice>>(CHOICES, {});
  delete all[fileID];
  all[fileID] = choice; // Re-inserted last, so the oldest go first when trimming.
  const ids = Object.keys(all);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_CHOICES))) delete all[id];
  writeJSON(CHOICES, all);
}

// Downloaded OpenSubtitles files are kept, so re-watching never spends another of the day's downloads.
const FILE_PREFIX = "pc.opensubtitles.file.";
const FILE_INDEX = "pc.opensubtitles.files.v1";
const MAX_FILES = 25;

export function cachedSubtitle(fileID: number): string | null {
  return readString(FILE_PREFIX + fileID);
}

export function cacheSubtitle(fileID: number, text: string) {
  const index = readJSON<number[]>(FILE_INDEX, []).filter((id) => id !== fileID);
  index.push(fileID);
  while (index.length > MAX_FILES) writeString(FILE_PREFIX + index.shift(), null);
  writeJSON(FILE_INDEX, index);
  writeString(FILE_PREFIX + fileID, text);
}
