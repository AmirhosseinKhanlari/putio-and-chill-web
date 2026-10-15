/** OpenSubtitles.com REST API v1 (port of the iPhone app's OpenSubtitlesClient). The API allows browser requests
 * (CORS, any header), so it is called directly with the user's API key from Settings. Browsers send their own
 * User-Agent, which the API accepts; the app's name goes in X-User-Agent. */
const BASE = "https://api.opensubtitles.com/api/v1";
/** Same-origin route for the subtitle file itself, used only when its host doesn't allow browser requests. */
export const FILE_PROXY = "/proxy/opensubtitles/file";
const APP = "PutioChill v0.1";

export interface SubtitleSearch {
  tmdbID?: number;
  kind?: "movie" | "tv";
  season?: number;
  episode?: number;
  /** Title text, when there is no TMDB match (or nothing listed under it). */
  query?: string;
  languages: string[];
}

export interface SubtitleResult {
  /** The file to download (`file_id`). */
  fileID: number;
  language: string;
  release: string;
  downloads: number;
  hearingImpaired: boolean;
  machineTranslated: boolean;
  trusted: boolean;
}

export type OpenSubtitlesProblem = "key" | "quota" | "busy" | "network" | "unreadable";

export class OpenSubtitlesError extends Error {
  constructor(readonly problem: OpenSubtitlesProblem, message: string) {
    super(message);
  }
}

/** OpenSubtitles uses regional codes for a few languages. */
export function openSubtitlesCode(code?: string | null): string {
  const lower = (code ?? "").toLowerCase();
  if (lower === "pt") return "pt-pt";
  if (lower === "zh") return "zh-cn";
  return lower || "en";
}

/** The API wants parameters sorted and lowercase (it redirects otherwise). Episodes use the show's TMDB id. */
export function searchURL(search: SubtitleSearch): string {
  const items: [string, string][] = [];
  if (search.languages.length) items.push(["languages", search.languages.map((l) => l.toLowerCase()).sort().join(",")]);
  if (search.tmdbID !== undefined) {
    if (search.kind === "tv") {
      items.push(["parent_tmdb_id", String(search.tmdbID)]);
      if (search.season !== undefined) items.push(["season_number", String(search.season)]);
      if (search.episode !== undefined) items.push(["episode_number", String(search.episode)]);
      items.push(["type", "episode"]);
    } else {
      items.push(["tmdb_id", String(search.tmdbID)]);
      items.push(["type", "movie"]);
    }
  } else if (search.query) {
    items.push(["query", search.query.toLowerCase()]);
    if (search.season !== undefined) items.push(["season_number", String(search.season)]);
    if (search.episode !== undefined) items.push(["episode_number", String(search.episode)]);
  }
  const query = items.sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `${BASE}/subtitles?${query}`;
}

interface SearchResponse {
  data?: {
    attributes?: {
      language?: string;
      release?: string;
      download_count?: number;
      hearing_impaired?: boolean;
      ai_translated?: boolean;
      machine_translated?: boolean;
      from_trusted?: boolean;
      files?: { file_id?: number; file_name?: string }[];
    };
  }[];
}

/** Best first: human-made, trusted, most downloaded. */
export function parseSearch(body: SearchResponse): SubtitleResult[] {
  const results: SubtitleResult[] = [];
  for (const item of body.data ?? []) {
    const a = item.attributes;
    const file = a?.files?.[0];
    if (!a || file?.file_id === undefined) continue;
    results.push({
      fileID: file.file_id,
      language: a.language ?? "",
      release: a.release || file.file_name || "Subtitle",
      downloads: a.download_count ?? 0,
      hearingImpaired: a.hearing_impaired ?? false,
      machineTranslated: Boolean(a.ai_translated || a.machine_translated),
      trusted: a.from_trusted ?? false,
    });
  }
  return results.sort((x, y) => {
    if (x.machineTranslated !== y.machineTranslated) return x.machineTranslated ? 1 : -1;
    if (x.trusted !== y.trusted) return x.trusted ? -1 : 1;
    return y.downloads - x.downloads;
  });
}

function headers(apiKey: string, json = false): HeadersInit {
  return { "Api-Key": apiKey, "X-User-Agent": APP, Accept: "application/json", ...(json ? { "Content-Type": "application/json" } : {}) };
}

async function call(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new OpenSubtitlesError("network", "Couldn't reach OpenSubtitles. Try again in a moment.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new OpenSubtitlesError("key", "OpenSubtitles didn't accept the API key. Check it in Settings.");
  }
  return response;
}

export async function search(apiKey: string, query: SubtitleSearch): Promise<SubtitleResult[]> {
  const response = await call(searchURL(query), { headers: headers(apiKey) });
  if (response.status === 429) throw new OpenSubtitlesError("busy", "OpenSubtitles is busy. Try again in a few seconds.");
  if (!response.ok) throw new OpenSubtitlesError("network", "Couldn't search OpenSubtitles. Try again in a moment.");
  return parseSearch((await response.json()) as SearchResponse);
}

/** By TMDB id first; when that finds nothing (or there's no match), by the title text. */
export async function findSubtitles(apiKey: string, video: Omit<SubtitleSearch, "query" | "languages"> & { title?: string; language: string }): Promise<SubtitleResult[]> {
  const languages = [video.language];
  const byID = video.tmdbID !== undefined
    ? await search(apiKey, { tmdbID: video.tmdbID, kind: video.kind, season: video.season, episode: video.episode, languages })
    : [];
  if (byID.length || !video.title) return byID;
  return search(apiKey, { query: video.title, season: video.season, episode: video.episode, languages });
}

/** Asks for a temporary download link; counts against the day's downloads for the key. */
export async function downloadLink(apiKey: string, fileID: number): Promise<{ link: string; remaining?: number }> {
  const response = await call(`${BASE}/download`, { method: "POST", headers: headers(apiKey, true), body: JSON.stringify({ file_id: fileID }) });
  if (response.status === 406 || response.status === 429) {
    throw new OpenSubtitlesError("quota", "You've used today's free OpenSubtitles downloads. Subtitles you already picked still work.");
  }
  if (!response.ok) throw new OpenSubtitlesError("network", "Couldn't download that subtitle. Try again or pick another.");
  const body = (await response.json()) as { link?: string; remaining?: number };
  if (!body.link) throw new OpenSubtitlesError("network", "Couldn't download that subtitle. Try again or pick another.");
  return { link: body.link, remaining: body.remaining };
}

/** Reads a file as UTF-8, else Latin-1 (older SRTs). */
export function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("iso-8859-1").decode(bytes);
  }
}

/** The subtitle file (SRT) from the download link: straight from its host, else through the app's proxy. */
export async function fetchSubtitleFile(link: string): Promise<string> {
  const read = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    // The single-page fallback answers unknown paths with the app itself.
    if ((response.headers.get("content-type") ?? "").includes("text/html")) throw new Error("html");
    return decodeText(await response.arrayBuffer());
  };
  try {
    return await read(link);
  } catch {
    try {
      return await read(`${FILE_PROXY}?url=${encodeURIComponent(link)}`);
    } catch {
      throw new OpenSubtitlesError("network", "Couldn't download that subtitle. Try again or pick another.");
    }
  }
}

/** Link, then file: the text and how many downloads are left today. */
export async function download(apiKey: string, fileID: number): Promise<{ text: string; remaining?: number }> {
  const { link, remaining } = await downloadLink(apiKey, fileID);
  return { text: await fetchSubtitleFile(link), remaining };
}
