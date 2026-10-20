/** chill.institute's search (port of the iPhone app's ChillProvider): finds releases for a movie, an episode or a
 * season. Signing in goes through put.io on chill.institute and comes back with #auth_token=… on our address.
 * It's one of the sources in src/api/sources; Get & Watch also works without it. */
import { parseReleaseName, type ParsedRelease } from "../lib/releaseName";
import { lossyNumber, matchesQuery, queryIMDbID, searchText, type Release, type ReleaseQuery, type SourceProvider } from "./sources/types";

export type { Release, ReleaseQuery } from "./sources/types";

const BASE = "https://api.chill.institute/v4";

export function chillSignInURL(returnTo: string): string {
  const url = new URL("https://api.chill.institute/auth/putio/start");
  url.searchParams.set("success_url", returnTo);
  return url.toString();
}

interface SearchResult {
  title?: string; indexer?: string; link?: string; seeders?: unknown; size?: unknown; source?: string;
  releaseInfo?: { title?: string; year?: number; season?: number; episode?: number; resolution?: string };
}
interface TVShowDownload { title?: string; link?: string; size?: unknown; seeders?: unknown; resolution?: string; indexer?: string }

function resolutionFromLabel(label?: string): ParsedRelease["resolution"] | undefined {
  const m = label ? /(4320|2160|1080|720|480)/.exec(label) : null;
  if (m) return Number(m[1]) as ParsedRelease["resolution"];
  if (label && /8k/i.test(label)) return 4320;
  if (label && /4k|uhd/i.test(label)) return 2160;
  return undefined;
}

const tag = (name?: string) => `chill · ${name || "chill"}`;

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
  return { name: r.title ?? "", link: r.link, sizeBytes: lossyNumber(r.size), seeders: lossyNumber(r.seeders), sources: [tag(r.source || r.indexer)], parsed };
}

function fromDownload(d: TVShowDownload): Release | undefined {
  if (!d.link) return undefined;
  const parsed = parseReleaseName(d.title ?? "");
  const res = resolutionFromLabel(d.resolution);
  if (res) parsed.resolution = res;
  return { name: d.title ?? "", link: d.link, sizeBytes: lossyNumber(d.size), seeders: lossyNumber(d.seeders), sources: [tag(d.indexer)], parsed };
}

export class ChillError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class ChillClient implements SourceProvider {
  readonly id = "chill" as const;
  private indexers?: Promise<{ id: string; name: string }[]>;

  constructor(private readonly token: string) {}

  private async call<T>(method: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${BASE}/chill.v4.UserService/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", "Connect-Protocol-Version": "1" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new ChillError(response.status, response.status === 401 ? "chill.institute sign-in expired. Connect it again in Settings." : `chill.institute ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  private enabledIndexers(signal?: AbortSignal) {
    this.indexers ??= this.call<{ indexers?: { id: string; name: string; enabled?: boolean }[] }>("GetIndexers", {}, signal)
      .then((r) => (r.indexers ?? []).filter((i) => i.enabled))
      .catch((error) => { this.indexers = undefined; throw error; });
    return this.indexers;
  }

  async releases(query: ReleaseQuery, signal?: AbortSignal): Promise<Release[]> {
    // The TV endpoints look shows up by IMDb id; a show without one is searched by title like a movie.
    const imdbID = queryIMDbID(query);
    if (query.kind === "episode" && imdbID) {
      const r = await this.call<{ download?: TVShowDownload }>("GetTVShowEpisodeDownload", { imdbId: imdbID, seasonNumber: query.season, episodeNumber: query.episode }, signal);
      return [r.download && fromDownload(r.download)].filter((x): x is Release => Boolean(x));
    }
    if (query.kind === "season" && imdbID) {
      const r = await this.call<{ seasonPack?: TVShowDownload }>("GetTVShowSeasonDownloads", { imdbId: imdbID, seasonNumber: query.season }, signal);
      return [r.seasonPack && fromDownload(r.seasonPack)].filter((x): x is Release => Boolean(x));
    }
    return this.searchAll(query, signal);
  }

  /** Free-text search on every enabled indexer, kept to what the query asked for. One indexer failing is fine. */
  private async searchAll(query: ReleaseQuery, signal?: AbortSignal): Promise<Release[]> {
    const text = searchText(query);
    const indexers = await this.enabledIndexers(signal);
    const settled = await Promise.allSettled(indexers.map((i) => this.call<{ results?: SearchResult[] }>("Search", { query: text, indexerId: i.id }, signal)));
    const found = settled.flatMap((s) => (s.status === "fulfilled" ? s.value.results ?? [] : []));
    if (!found.length) {
      const failure = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
      if (failure) throw failure.reason;
    }
    return found.map(fromSearch).filter((x): x is Release => Boolean(x) && matchesQuery(x!.parsed, query));
  }
}
