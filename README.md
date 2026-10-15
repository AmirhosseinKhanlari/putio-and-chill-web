# Putio & Chill — web

The web version of the Putio & Chill app: pick a movie or show, send it to put.io, and watch it in the browser.

## Run it

```bash
npm install
cp .env.example .env.local   # then fill in VITE_TMDB_TOKEN
npm run dev                  # http://localhost:5173
```

Sign in with put.io: the app shows a short code, you enter it at put.io/link. Get & Watch and Versions search the
torrent sources turned on in Settings → Sources (YTS, EZTV, The Pirate Bay, Knaben, Torrents.csv); connecting
chill.institute in Settings → Connected Services adds its indexers too, but nothing needs it.

## Check it

```bash
npm test           # parser, matcher, library index, Smart Get, sources and proxy
npm run typecheck
npm run build      # static site in dist/
```

## What's where

- `src/api/` — put.io, TMDB and chill.institute clients (all allow browser requests).
- `src/api/sources/` — the torrent sources, one module each (ports of the iPhone app's providers), and `index.ts`, the
  aggregator: every source that's on is asked in parallel (12 s each), magnet links are built from info-hashes, the
  same torrent from several sources becomes one row (most seeders wins), and results are filtered to the episode,
  season pack or movie asked for.
- `src/lib/library.ts` — reads every folder in put.io, matches each video to TMDB (once per name), and keeps watch
  positions and video lengths for the watched bars. Ported from the iPhone app's LibraryIndex.
- `src/lib/releaseName.ts`, `src/lib/matcher.ts`, `src/lib/smartGet.ts` — release-name parsing, title matching and
  Get & Watch's choice of release, as in the iPhone app. Files go to the same put.io folders (AMDB/Movies,
  AMDB/TV/<Show>/Season N).
- `src/pages/` — Home, Movies, TV, Coming Up, Search, Library, Files, title page, player, Settings, sign-in.
- `src/pages/Settings.tsx`, `src/components/settings/` — Settings as a hub of pages, like the iPhone app (the open page is
  `?page=…`): Playback (auto-play, audio language), Subtitles (language, style with a preview, OpenSubtitles API key),
  Smart Get (one-tap Get, quality, size limit, Versions' default quality), Sources, Library (automatic updates and
  interval, Update Now), put.io Folders (Movies and TV folders picked by browsing put.io, season folders), Connected
  Services (chill.institute, IMDb watchlist link), About. Everything is in `src/lib/settings.ts`, saved in this browser.

## The proxy

Some services don't allow browser requests (apibay.org, api.knaben.org, OpenSubtitles, IMDb's GraphQL API, mymoviz.co),
so the site has a small same-origin proxy: `/proxy/<name>/<path>` goes to that name's address in
`src/api/sources/proxyTargets.ts`, and nowhere else. Only GET/HEAD/POST (GET/HEAD for mymoviz) and a few headers
(Accept, Accept-Language, Content-Type, Authorization, plus each target's own) are passed on; cookies, origin and
referrer are not, and only the body, status and content type come back. `/proxy/opensubtitles/file?url=…` fetches one
subtitle file, only from https links on opensubtitles.com / opensubtitles.org (400 otherwise).

- In development, `vite.config.ts` sets this up on the dev server (restart it after changing the list).
- In production, `functions/proxy/[[path]].ts` is a Cloudflare Pages Function doing the same.

To add a service, add a name and base address to `proxyTargets` (and any headers it needs); both use the same list.

## Deploying

`npm run build` makes a static site in `dist/`; `public/_redirects` sends every path to the app. Deploy to Cloudflare
Pages so `functions/` runs too (without it, The Pirate Bay, Knaben, OpenSubtitles search and the IMDb lists fail and
the other sources still work). Set `VITE_TMDB_TOKEN` in the host's build settings.

Note: `VITE_` values are built into the page, so anyone can read the TMDB token from a deployed site. TMDB read tokens
are meant for apps like this, but use a token made for the web app (not the iPhone app's) so it can be replaced on its
own. put.io and chill.institute sign-ins stay in each visitor's browser (localStorage) and are never in the build.
