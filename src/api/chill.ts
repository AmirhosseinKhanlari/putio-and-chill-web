/** chill.institute's search (port of the iPhone app's ChillProvider): finds releases for a movie, an episode or a
 * season. Signing in goes through put.io on chill.institute and comes back with #auth_token=… on our address. */
import { parseReleaseName, type ParsedRelease } from "../lib/releaseName";

const BASE = "https://api.chill.institute/v4";

export interface Release {
  name: string;
  link: string;
  sizeBytes?: number;
  seeders?: number;
  source: string;
  parsed: ParsedRelease;
}

export type ReleaseQuery =
  | { kind: "movie"; title: string; year?: number }
  | { kind: "episode"; imdbID: string; season: number; episode: number }
  | { kind: "season"; imdbID: string; season: number }
  | { kind: "text"; text: string };

export function chillSignInURL(returnTo: string): string {
  const url = new URL("https://api.chill.institute/auth/putio/start");
  url.searchParams.set("success_url", returnTo);
  return url.toString();
}

const lossyNumber = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number(v));

interface SearchResult {
  title?: string; indexer?: string; link?: string; seeders?: unknown; size?: unknown; source?: string;
  releaseInfo?: { title?: string; year?: number; season?: number; episode?: number; resolution?: string };
}
interface TVShowDownload { title?: string; link?: string; size?: unknown; seeders?: unknown; resolution?: string; indexer?: string }

function resolutionFromLabel(label?: string): ParsedRelease["resolution"] | undefined {
  const m = label ? /(4320|2160|1080|720|480)/.exec(label) : null;
  if (m) return Number(m[1]) as ParsedRelease["resolution"];
  if (label && /4k|uhd/i.test(label)) return 2160;
  return undefined;
}

function fromSearch(r: SearchResult): Release | undefined {
  if (!r.link) return undefined;
  const parsed = parseReleaseName(r.title ?? "");
  const info = r.releaseInfo;
  if (info?.title) parsed.title = info.title;
  if (info?.year) parsed.year = info.year;
  if (info?.season) parsed.season = info.season;
  if (info?.episode) parsed.episode = info.episode;
  const res = resolutionFromLabel(info?.resolution);
  if (res) parsed.resolution = res;
  return { name: r.title ?? "", link: r.link, sizeBytes: lossyNumber(r.size), seeders: lossyNumber(r.seeders), source: r.source || r.indexer || "chill", parsed };
}

function fromDownload(d: TVShowDownload): Release | undefined {
  if (!d.link) return undefined;
  const parsed = parseReleaseName(d.title ?? "");
  const res = resolutionFromLabel(d.resolution);
  if (res) parsed.resolution = res;
  return { name: d.title ?? "", link: d.link, sizeBytes: lossyNumber(d.size), seeders: lossyNumber(d.seeders), source: d.indexer || "chill", parsed };
}

export class ChillError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class ChillClient {
  private indexers?: Promise<{ id: string; name: string }[]>;

  constructor(private readonly token: string) {}

  private async call<T>(method: string, body: unknown): Promise<T> {
    const response = await fetch(`${BASE}/chill.v4.UserService/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", "Connect-Protocol-Version": "1" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new ChillError(response.status, response.status === 401 ? "chill.institute sign-in expired. Connect it again in Settings." : `chill.institute ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  private enabledIndexers() {
    this.indexers ??= this.call<{ indexers?: { id: string; name: string; enabled?: boolean }[] }>("GetIndexers", {})
      .then((r) => (r.indexers ?? []).filter((i) => i.enabled));
    return this.indexers;
  }

  async releases(query: ReleaseQuery): Promise<Release[]> {
    if (query.kind === "episode") {
      const r = await this.call<{ download?: TVShowDownload }>("GetTVShowEpisodeDownload", { imdbId: query.imdbID, seasonNumber: query.season, episodeNumber: query.episode });
      return [r.download && fromDownload(r.download)].filter((x): x is Release => Boolean(x));
    }
    if (query.kind === "season") {
      const r = await this.call<{ seasonPack?: TVShowDownload }>("GetTVShowSeasonDownloads", { imdbId: query.imdbID, seasonNumber: query.season });
      return [r.seasonPack && fromDownload(r.seasonPack)].filter((x): x is Release => Boolean(x));
    }
    const text = query.kind === "movie" ? [query.title, query.year].filter(Boolean).join(" ") : query.text;
    const indexers = await this.enabledIndexers();
    const settled = await Promise.allSettled(indexers.map((i) => this.call<{ results?: SearchResult[] }>("Search", { query: text, indexerId: i.id })));
    const found = settled.flatMap((s) => (s.status === "fulfilled" ? s.value.results ?? [] : []));
    if (!found.length) {
      const failure = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
      if (failure) throw failure.reason;
    }
    const releases = found.map(fromSearch).filter((x): x is Release => Boolean(x));
    // Same link from several indexers: keep the one with the most seeders.
    const byLink = new Map<string, Release>();
    for (const r of releases) {
      const seen = byLink.get(r.link);
      if (!seen || (r.seeders ?? 0) > (seen.seeders ?? 0)) byLink.set(r.link, r);
    }
    const all = [...byLink.values()];
    return query.kind === "movie" ? all.filter((r) => matchesMovie(r.parsed, query.title, query.year)) : all;
  }
}

function matchesMovie(parsed: ParsedRelease, title: string, year?: number): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (parsed.season !== undefined) return false;
  if (norm(parsed.title) !== norm(title)) return false;
  return year === undefined || parsed.year === undefined || Math.abs(parsed.year - year) <= 1;
}
