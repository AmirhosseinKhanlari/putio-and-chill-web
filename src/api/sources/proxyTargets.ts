/** The same-origin proxy for services that don't allow browser requests (no CORS): `/proxy/<name>/<path>` goes to
 * the base address below. Used by the dev server (vite.config.ts) and by the Cloudflare Pages Function in
 * functions/proxy/[[path]].ts, so this list is the only place to add a service. Only these hosts are reachable; the
 * proxy is never open. */
export interface ProxyTarget {
  /** Scheme and host, no trailing slash. */
  base: string;
  /** Request headers passed on besides `commonHeaders` (lowercase). */
  headers?: string[];
  /** Headers always sent (a browser can't set User-Agent, which OpenSubtitles asks apps for). */
  fixed?: Record<string, string>;
  /** Methods allowed; default `proxyMethods`. */
  methods?: string[];
}

export const proxyTargets = {
  apibay: { base: "https://apibay.org" },
  knaben: { base: "https://api.knaben.org" },
  opensubtitles: { base: "https://api.opensubtitles.com", headers: ["api-key"], fixed: { "User-Agent": "PutioChill v1.0" } },
  imdb: { base: "https://api.graphql.imdb.com", headers: ["x-imdb-client-name", "x-imdb-user-country", "x-imdb-user-language"] },
  /** Latest-movies and latest-shows pages (HTML), read by the lists pages. */
  mymoviz: { base: "https://mymoviz.co", methods: ["GET", "HEAD"] },
  /** Search and detail pages (HTML). It's a browser site, so the proxy asks like a browser; lowercase keys replace
   * the browser's own Accept. */
  torrentgalaxy: {
    base: "https://torrentgalaxy.info",
    methods: ["GET", "HEAD"],
    fixed: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      accept: "text/html,application/xhtml+xml",
    },
  },
} satisfies Record<string, ProxyTarget>;

export type ProxyName = keyof typeof proxyTargets;

/** Passed on for every target; cookies, origin and referrer never are. */
export const commonHeaders = ["accept", "accept-language", "content-type", "authorization"];

export const proxyMethods = ["GET", "HEAD", "POST"];

export const allowsMethod = (target: ProxyTarget, method: string) => (target.methods ?? proxyMethods).includes(method.toUpperCase());

/** The address to fetch from the app: proxyURL("apibay", "q.php?q=dune"). */
export function proxyURL(name: ProxyName, pathAndQuery: string): string {
  return `/proxy/${name}/${pathAndQuery.replace(/^\/+/, "")}`;
}

/** Where `/proxy/<name>/<rest>?<query>` goes, or undefined when the name isn't listed. The rest is appended after
 * a "/" and the result must stay on the target's host ("//evil.example" or "@evil.example" can't leave it). */
export function resolveProxy(pathname: string, search = ""): { name: ProxyName; target: ProxyTarget; url: string } | undefined {
  const m = /^\/proxy\/([a-z0-9-]+)(?:\/(.*))?$/.exec(pathname);
  if (!m || !Object.prototype.hasOwnProperty.call(proxyTargets, m[1])) return undefined;
  const name = m[1] as ProxyName;
  const target: ProxyTarget = proxyTargets[name];
  const url = `${target.base}/${m[2] ?? ""}${search}`;
  try {
    if (new URL(url).origin !== new URL(target.base).origin) return undefined;
  } catch {
    return undefined;
  }
  return { name, target, url };
}

/** The request headers to send on: the common ones, the target's own, then its fixed ones. */
export function forwardHeaders(target: ProxyTarget, incoming: Iterable<[string, string]>): Record<string, string> {
  const allowed = new Set([...commonHeaders, ...(target.headers ?? [])]);
  const out: Record<string, string> = {};
  for (const [key, value] of incoming) if (allowed.has(key.toLowerCase())) out[key.toLowerCase()] = value;
  return { ...out, ...target.fixed };
}

/** The player's fallback for subtitle downloads: `GET /proxy/opensubtitles/file?url=<link>`. Only https links on
 * opensubtitles.com, opensubtitles.org or their subdomains are fetched (redirects too); anything else is a 400. */
export const subtitleFilePath = "/proxy/opensubtitles/file";

export function isSubtitleFileURL(link: string | null): boolean {
  if (!link) return false;
  try {
    const url = new URL(link);
    return url.protocol === "https:" && !url.username && !url.password && /(^|\.)opensubtitles\.(com|org)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/** Fetches the subtitle file named by `?url=`, following at most three redirects that stay on OpenSubtitles. */
export async function subtitleFileResponse(search: string, method: string): Promise<Response> {
  if (method !== "GET" && method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  let link = new URLSearchParams(search).get("url");
  for (let hop = 0; hop < 4; hop++) {
    if (!isSubtitleFileURL(link)) return new Response("Only OpenSubtitles links", { status: 400 });
    let upstream: Response;
    try {
      upstream = await fetch(link!, { method, redirect: "manual" });
    } catch {
      return new Response("OpenSubtitles couldn't be reached", { status: 502 });
    }
    const location = upstream.headers.get("location");
    if (upstream.status >= 300 && upstream.status < 400 && location) {
      link = new URL(location, link!).toString();
      continue;
    }
    const headers = new Headers({ "Cache-Control": "no-store" });
    const type = upstream.headers.get("content-type");
    if (type) headers.set("Content-Type", type);
    return new Response(method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
  }
  return new Response("Too many redirects", { status: 400 });
}
