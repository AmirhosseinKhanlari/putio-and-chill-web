/** Cloudflare Pages Function: /proxy/<name>/… → the allow-listed service in src/api/sources/proxyTargets.ts, for
 * the sources that don't allow browser requests (apibay, Knaben, …). The dev server does the same (vite.config.ts).
 * Only listed hosts, GET/HEAD/POST and the allowed headers go out; only the body, status and content type come
 * back, so it can't be used as an open proxy or to set cookies on this site. /proxy/opensubtitles/file?url=… fetches
 * one subtitle file, only from OpenSubtitles hosts (see subtitleFileResponse). */
import { allowsMethod, forwardHeaders, proxyMethods, resolveProxy, subtitleFilePath, subtitleFileResponse } from "../../src/api/sources/proxyTargets";

interface Context { request: Request }

export async function onRequest({ request }: Context): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === subtitleFilePath) return subtitleFileResponse(url.search, request.method);
  const resolved = resolveProxy(url.pathname, url.search);
  if (!resolved) return new Response("Not found", { status: 404 });
  if (!allowsMethod(resolved.target, request.method)) {
    return new Response("Method not allowed", { status: 405, headers: { Allow: (resolved.target.methods ?? proxyMethods).join(", ") } });
  }

  let upstream: Response;
  try {
    upstream = await fetch(resolved.url, {
      method: request.method,
      headers: forwardHeaders(resolved.target, request.headers.entries()),
      body: request.method === "POST" ? await request.arrayBuffer() : undefined,
      // A redirect could point anywhere; it comes back as an error instead.
      redirect: "manual",
    });
  } catch {
    return new Response(`${resolved.name} couldn't be reached`, { status: 502 });
  }
  const headers = new Headers({ "Cache-Control": "no-store" });
  const type = upstream.headers.get("content-type");
  if (type) headers.set("Content-Type", type);
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
}
