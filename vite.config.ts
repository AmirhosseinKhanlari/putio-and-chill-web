import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { allowsMethod, forwardHeaders, proxyTargets, resolveProxy, subtitleFilePath, subtitleFileResponse, type ProxyTarget } from "./src/api/sources/proxyTargets";

/** /proxy/<name>/… → the allow-listed service (src/api/sources/proxyTargets.ts), as functions/proxy/[[path]].ts
 * does in production. Only the allowed headers go out; cookies, origin and referrer never do. */
function devProxy(): Record<string, ProxyOptions> {
  return Object.fromEntries(Object.entries(proxyTargets).map(([name, target]: [string, ProxyTarget]) => [`/proxy/${name}/`, {
    target: target.base,
    changeOrigin: true,
    rewrite: (path: string) => path.slice(`/proxy/${name}`.length),
    configure: (proxy) => {
      proxy.on("proxyReq", (req) => {
        const incoming = req.getHeaderNames().map((key: string): [string, string] => [key, String(req.getHeader(key))]);
        const keep = forwardHeaders(target, incoming);
        for (const key of req.getHeaderNames()) if (!["host", "content-length"].includes(key)) req.removeHeader(key);
        for (const [key, value] of Object.entries(keep)) req.setHeader(key, value);
      });
      proxy.on("proxyRes", (res) => { delete res.headers["set-cookie"]; });
    },
  } satisfies ProxyOptions]));
}

/** In development: /proxy/opensubtitles/file?url=… (the target host varies, so it isn't a plain proxy entry), and
 * the same 404/405 answers as production for unknown names and methods. Plugin middleware runs before Vite's
 * proxy, so these never reach the proxy entries. */
function proxyGuard(): Plugin {
  return {
    name: "proxy-guard",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/proxy/")) return next();
        if (url.pathname !== subtitleFilePath) {
          const resolved = resolveProxy(url.pathname, url.search);
          if (resolved && allowsMethod(resolved.target, req.method ?? "GET")) return next();
          res.statusCode = resolved ? 405 : 404;
          return res.end(resolved ? "Method not allowed" : "Not found");
        }
        const response = await subtitleFileResponse(url.search, req.method ?? "GET");
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(new Uint8Array(await response.arrayBuffer()));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), proxyGuard()],
  server: { port: 5173, proxy: devProxy() },
});
