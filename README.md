# Putio & Chill — web

The web version of the Putio & Chill app: pick a movie or show, send it to put.io, and watch it in the browser.

## Run it

```bash
npm install
cp .env.example .env.local   # then fill in VITE_TMDB_TOKEN
npm run dev                  # http://localhost:5173
```

Sign in with put.io: the app shows a short code, you enter it at put.io/link. To get movies and shows, connect
chill.institute in Settings (it signs in through put.io and comes back to the app).

## Check it

```bash
npm test           # parser, matcher, library index, Smart Get
npm run typecheck
npm run build      # static site in dist/
```

## What's where

- `src/api/` — put.io, TMDB and chill.institute clients. All three allow browser requests (CORS), so there is no server.
- `src/lib/library.ts` — reads every folder in put.io, matches each video to TMDB (once per name), and keeps watch
  positions and video lengths for the watched bars. Ported from the iPhone app's LibraryIndex.
- `src/lib/releaseName.ts`, `src/lib/matcher.ts`, `src/lib/smartGet.ts` — release-name parsing, title matching and
  Get & Watch's choice of release, as in the iPhone app. Files go to the same put.io folders (AMDB/Movies,
  AMDB/TV/<Show>/Season N).
- `src/pages/` — Home, Movies, TV, Coming Up, Search, Library, Files, title page, player, Settings, sign-in.

## Deploying

`npm run build` makes a static site in `dist/`; `public/_redirects` sends every path to the app (Cloudflare Pages,
Netlify). Set `VITE_TMDB_TOKEN` in the host's build settings.

Note: `VITE_` values are built into the page, so anyone can read the TMDB token from a deployed site. TMDB read tokens
are meant for apps like this, but use a token made for the web app (not the iPhone app's) so it can be replaced on its
own. put.io and chill.institute sign-ins stay in each visitor's browser (localStorage) and are never in the build.
