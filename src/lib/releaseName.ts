/** What a release or file name says about itself ("Severance.S02E04.1080p.WEB.H264-NTb.mkv"). Port of the
 * iPhone app's ReleaseNameParser. Scene names use "." as a word separator, so word boundaries are ASCII ones. */
export type Resolution = 4320 | 2160 | 1080 | 720 | 480 | 0;

export interface ParsedRelease {
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  episodeEnd?: number;
  resolution: Resolution;
  source?: string;
  codec?: string;
  audio?: string;
  hdr: string[];
  group?: string;
  isProper: boolean;
  isRepack: boolean;
  isExtended: boolean;
  isComplete: boolean;
}

// \b in JS regexes is already ASCII-only, which is what scene names need.
const sourceRules: [RegExp, string][] = [
  [/\bREMUX\b/i, "REMUX"], [/\bWEB[ .-]?DL\b/i, "WEB-DL"], [/\bWEB[ .-]?Rip\b/i, "WEBRip"],
  [/\b(?:Blu[ .-]?Ray|BDRip|BRRip)\b/i, "BluRay"], [/\bHDTV\b/i, "HDTV"],
  [/\bDVD[ .-]?Rip\b/i, "DVDRip"], [/\bHDRip\b/i, "HDRip"],
  [/\b(?:CAM|HDCAM|TS|TELESYNC|HDTS)\b/i, "CAM"], [/\bWEB\b/i, "WEB"],
];
const codecRules: [RegExp, string][] = [
  [/\b(?:x265|HEVC|H[ .]?265)\b/i, "H.265"], [/\b(?:x264|AVC|H[ .]?264)\b/i, "H.264"],
  [/\bAV1\b/i, "AV1"], [/\bXviD\b/i, "XviD"],
];
const audioRules: [RegExp, string][] = [
  [/\bAtmos\b/i, "Atmos"], [/\bTrueHD\b/i, "TrueHD"], [/\bDTS[ .-]?HD\b/i, "DTS-HD"],
  [/\bDTS\b/i, "DTS"], [/\b(?:DDP|DD\+|EAC3)/i, "DD+"],
  [/\b(?:DD|AC3)(?:[ .]?\d[ .]\d)?\b/i, "DD"], [/\bAAC/i, "AAC"],
];

export function parseReleaseName(raw: string): ParsedRelease {
  const r: ParsedRelease = { title: "", resolution: 0, hdr: [], isProper: false, isRepack: false, isExtended: false, isComplete: false };
  let name = raw.replace(/_/g, ".");
  name = name.replace(/^\s*\[[^\]]*\]\s*/, "");
  name = name.replace(/\.(mkv|mp4|avi|m4v|mov|torrent)$/i, "");

  let cut = name.length;
  const mark = (index: number) => { if (index < cut) cut = index; };
  const find = (re: RegExp) => re.exec(name);

  let m: RegExpExecArray | null;
  if ((m = find(/\bS(\d{1,2})[ .]?E(\d{1,3})(?:-?E(\d{1,3}))?\b/i))) {
    r.season = Number(m[1]); r.episode = Number(m[2]); if (m[3]) r.episodeEnd = Number(m[3]);
    mark(m.index);
  } else if ((m = find(/\b(\d{1,2})x(\d{2,3})\b/i))) {
    r.season = Number(m[1]); r.episode = Number(m[2]);
    mark(m.index);
  } else if ((m = find(/\b(?:S|Season[ .]?)(\d{1,2})\b/i))) {
    r.season = Number(m[1]);
    mark(m.index);
  }

  if ((m = find(/\b(4320|2160|1080|720|480)[pi]\b/i))) {
    r.resolution = Number(m[1]) as Resolution;
    mark(m.index);
  } else if ((m = find(/\b(?:8K|FUHD)\b/i))) {
    r.resolution = 4320; mark(m.index);
  } else if ((m = find(/\b(?:4K|UHD)\b/i))) {
    r.resolution = 2160; mark(m.index);
  }

  const firstRule = (rules: [RegExp, string][]) => {
    for (const [re, label] of rules) {
      const hit = re.exec(name);
      if (hit) { mark(hit.index); return label; }
    }
    return undefined;
  };
  r.source = firstRule(sourceRules);
  r.codec = firstRule(codecRules);
  r.audio = firstRule(audioRules);

  if ((m = find(/\bHDR10(?:\+|Plus)/i))) { r.hdr.push("HDR10+"); mark(m.index); }
  else if ((m = find(/\bHDR(?:10)?\b/i))) { r.hdr.push("HDR"); mark(m.index); }
  if ((m = find(/\b(?:DV|DoVi|Dolby[ .]?Vision)\b/i))) { r.hdr.push("DV"); mark(m.index); }

  if ((m = find(/\bPROPER\b/i))) { r.isProper = true; mark(m.index); }
  if ((m = find(/\bREPACK\b/i))) { r.isRepack = true; mark(m.index); }
  if ((m = find(/\bEXTENDED\b/i))) { r.isExtended = true; mark(m.index); }
  if ((m = find(/\bCOMPLETE\b/i))) { r.isComplete = true; mark(m.index); }

  if ((m = find(/-([A-Za-z0-9]+)(?:\[[^\]]*\])?\s*$/))) {
    if (!["dl", "rip"].includes(m[1].toLowerCase())) r.group = m[1];
  }

  // Year: the last 19xx/20xx before the cut that isn't at the very start.
  const years = [...name.matchAll(/\b(19\d{2}|20\d{2})\b/g)].filter((y) => (y.index ?? 0) > 0 && (y.index ?? 0) < cut);
  const last = years[years.length - 1];
  if (last) { r.year = Number(last[1]); mark(last.index ?? cut); }

  let title = name.slice(0, cut);
  if (!title.includes(" ")) title = title.replace(/\./g, " ");
  title = title.replace(/^[\s.\-_([{]+|[\s.\-_([{]+$/g, "");
  r.title = title.split(/\s+/).filter(Boolean).join(" ");
  return r;
}

export function resolutionLabel(resolution: Resolution): string {
  switch (resolution) {
    case 4320: return "8K";
    case 2160: return "4K";
    case 0: return "";
    default: return `${resolution}p`;
  }
}
