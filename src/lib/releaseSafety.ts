/** Spots fake and malware torrents: releases named like a video but carrying a program, an archive or a tiny file
 * (port of the iPhone app's ReleaseSafety). Kept tight on purpose, so real releases (whose names follow scene habits)
 * never trip it; unknown sizes and file lists are never held against a release. */
import type { ParsedRelease } from "./releaseName";

/** One file inside a torrent, as a source lists it. */
export interface TorrentFile { name: string; sizeBytes?: number }

/** Why a release was left out. */
export type ReleaseRejection =
  | { kind: "program"; ext: string }
  | { kind: "archive"; ext: string }
  | { kind: "discImage" }
  | { kind: "spam"; marker: string }
  | { kind: "tooSmall"; bytes: number; minimum: number }
  | { kind: "tooLarge"; bytes: number; maximum: number }
  | { kind: "notVideo"; largest: string }
  | { kind: "containsProgram"; name: string }
  | { kind: "knownBad" };

const MB = 1_048_576;
const GB = 1_073_741_824;

/** Payloads that run code. ".com" is left out: plenty of real names end with a site ("…-www.Site.com"). */
export const programExtensions = new Set(["exe", "scr", "bat", "cmd", "msi", "lnk", "pif", "vbs", "js", "jar", "apk", "dmg", "pkg"]);
/** Programs that can also be named mid-name ("Movie.2025.1080p.exe [x]"). The rest stay end-only, because they read as
 * words or tags elsewhere ("The.Bat.1959", "SCR" for screener). */
const programsAnywhere = ["exe", "msi", "lnk", "vbs", "pif"];
export const archiveExtensions = new Set(["zip", "rar", "7z", "tar", "gz", "tgz"]);
export const discExtensions = new Set(["iso", "img"]);
export const videoExtensions = new Set(["mkv", "mp4", "m4v", "avi", "mov", "ts", "m2ts", "wmv", "webm", "mpg", "mpeg", "vob", "divx", "flv"]);

/** Phrases no real release uses. */
const spamPhrases: [RegExp, string][] = [
  [/\bcodecs?[ .]*(?:required|needed|pack|download|install)/i, "codec required"],
  [/\b(?:divx|xvid|video)[ .]+codec\b/i, "codec"],
  [/\bplayer[ .]*required\b/i, "player required"],
  [/\bwatch[ .]*online\b/i, "watch online"],
  [/\bfull[ .]*movie[ .]*free\b/i, "full movie free"],
  [/\b(?:free[ .]*download|download[ .]*free)\b/i, "free download"],
  [/\bhttps?:\/\//i, "web address"],
  [/\b(?:bit\.ly|tinyurl\.com|goo\.gl|cutt\.ly|shorturl\.at)\b/i, "short link"],
  [/\bvisit[ .]+(?:www\.|https?\b)/i, "web address"],
];
/** Single words fakes use. They don't count when the title asked for has them ("Crack" (2024), "The Setup"). */
const spamWords = ["codec", "codecs", "password", "passwd", "keygen", "crack", "setup", "install", "installer"];
/** Disc names: an ".iso" passes only when named like a real disc and big enough to be one. */
const discName = /\b(?:blu[ .-]?ray|bdmv|bd(?:25|50|66|100)|uhd[ .-]?bd|dvd(?:5|9|r)?|video[ ._]ts)\b/i;
const discMinimum = 3 * GB;
/** Names that are several titles at once, where any size goes ("Trilogy", "Complete Series"). */
const collectionName = /\b(?:collection|trilogy|duology|quadrilogy|saga|anthology|pack|box[ .-]?set|filmography|complete)\b/i;

const extension = (name: string) => /\.([^./\\]+)$/.exec(name)?.[1].toLowerCase() ?? "";
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
/** "Movie.2025.1080p.mkv.exe" → "exe"; undefined when the name doesn't end in a short extension. */
const endingExtension = (name: string) => /\.([A-Za-z0-9]{1,4})$/.exec(name)?.[1].toLowerCase();

export const isVideoFile = (name: string) => videoExtensions.has(extension(name));
export const isProgramFile = (name: string) => programExtensions.has(extension(name));
export const isDiscImage = (name: string) => discExtensions.has(extension(name));

/** Lowercased words without accents or punctuation (for the title asked for). */
const words = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function spam(name: string, askedTitle?: string): string | undefined {
  const phrase = spamPhrases.find(([re]) => re.test(name));
  if (phrase) return phrase[1];
  const asked = new Set(askedTitle ? words(askedTitle) : []);
  const found = new Set(words(name));
  return spamWords.find((w) => found.has(w) && !asked.has(w));
}

/** Smallest and largest believable size for what the name says it is. Minimums: a 2160p movie 1 GB, 1080p 150 MB,
 * 720p 80 MB, anything else 40 MB; an episode 40 MB (20 MB below 720p), times the episodes a range or season pack
 * holds (a pack counts as at least two). Maximums: 150 GB for one movie, 60 GB for one episode; packs and collections
 * have none. */
export function sizeLimits(parsed: ParsedRelease, name: string): { minimum: number; maximum?: number } {
  if (parsed.season !== undefined || parsed.episode !== undefined) {
    const perEpisode = parsed.resolution >= 720 ? 40 * MB : 20 * MB;
    if (parsed.episode !== undefined) {
      const count = Math.max((parsed.episodeEnd ?? parsed.episode) - parsed.episode + 1, 1);
      return { minimum: perEpisode * count, maximum: count === 1 ? 60 * GB : undefined };
    }
    return { minimum: perEpisode * 2 };
  }
  const minimum = parsed.resolution >= 2160 ? GB : parsed.resolution === 1080 ? 150 * MB : parsed.resolution === 720 ? 80 * MB : 40 * MB;
  const isCollection = parsed.isComplete || collectionName.test(name);
  return { minimum, maximum: isCollection ? undefined : 150 * GB };
}

/** Why the release looks fake from its name and size, or undefined when it looks fine. `askedTitle` (the title or
 * text searched for) exempts its own words from the fake-word list. */
export function releaseRejection(rawName: string, sizeBytes: number | undefined, parsed: ParsedRelease, askedTitle?: string): ReleaseRejection | undefined {
  const name = rawName.trim();
  const ext = endingExtension(name);
  if (ext && programExtensions.has(ext)) return { kind: "program", ext };
  const anywhere = programsAnywhere.find((e) => new RegExp(`\\.${e}(?![A-Za-z0-9])`, "i").test(name));
  if (anywhere) return { kind: "program", ext: anywhere };
  if (ext && archiveExtensions.has(ext)) return { kind: "archive", ext };
  if (ext && discExtensions.has(ext)) {
    const sized = sizeBytes === undefined || sizeBytes >= discMinimum;
    if (!discName.test(name) || !sized) return { kind: "discImage" };
  }
  const marker = spam(name, askedTitle);
  if (marker) return { kind: "spam", marker };
  if (sizeBytes !== undefined && sizeBytes > 0) {
    const { minimum, maximum } = sizeLimits(parsed, name);
    if (sizeBytes < minimum) return { kind: "tooSmall", bytes: sizeBytes, minimum };
    if (maximum !== undefined && sizeBytes > maximum) return { kind: "tooLarge", bytes: sizeBytes, maximum };
  }
  return undefined;
}

/** Why the files inside look fake: a program among them, or a biggest file that isn't a video (a real disc image is
 * allowed). An empty list says nothing. */
export function filesRejection(files: TorrentFile[]): ReleaseRejection | undefined {
  if (!files.length) return undefined;
  const program = files.find((f) => isProgramFile(f.name));
  if (program) return { kind: "containsProgram", name: baseName(program.name) };
  const largest = files.reduce((a, b) => ((b.sizeBytes ?? 0) > (a.sizeBytes ?? 0) ? b : a));
  if (isVideoFile(largest.name)) return undefined;
  if (isDiscImage(largest.name) && (largest.sizeBytes ?? 0) >= discMinimum) return undefined;
  return { kind: "notVideo", largest: baseName(largest.name) };
}

/** The short reason written to the debug log. */
export function describeRejection(r: ReleaseRejection): string {
  const mb = (n: number) => `${Math.floor(n / MB)} MB`;
  switch (r.kind) {
    case "program": return `program file (.${r.ext})`;
    case "archive": return `archive (.${r.ext})`;
    case "discImage": return "disc image that doesn't look like a real disc";
    case "spam": return `fake wording "${r.marker}"`;
    case "tooSmall": return `too small (${mb(r.bytes)} < ${mb(r.minimum)})`;
    case "tooLarge": return `too large (${mb(r.bytes)} > ${mb(r.maximum)})`;
    case "notVideo": return `biggest file isn't a video (${r.largest})`;
    case "containsProgram": return `contains a program (${r.name})`;
    case "knownBad": return "downloaded before and found fake";
  }
}
