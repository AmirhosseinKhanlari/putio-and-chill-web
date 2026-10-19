# Development

## Setup

1. **Install tools**: Node.js 20 or later and npm.
2. **Add your keys**: copy the template and fill it in. `.env.local` is gitignored; never commit it.
   ```bash
   cp .env.example .env.local
   ```
   | Key | Required | Notes |
   |---|---|---|
   | `VITE_TMDB_TOKEN` | yes | TMDB → Settings → API → *API Read Access Token* (the long JWT, not the short API key) |
   | `VITE_TRAKT_CLIENT_ID` | for Top 250 and box office | trakt.tv → Your API Apps → New Application |
   | `VITE_PUTIO_APP_ID` | no | The put.io OAuth app the sign-in code belongs to; the template has a working default |
3. **Install and run**:
   ```bash
   npm install
   npm run dev        # http://localhost:5173
   ```
   Vite restarts on its own for most changes; restart it by hand after editing `proxyTargets.ts`, because the
   dev-server proxy is built from that list when the server starts.

### Scripts

| Script | Does |
|---|---|
| `npm run dev` | Dev server with hot reload and the development proxy |
| `npm test` | Vitest: parser, matcher, library index, Smart Get, sources, lists, subtitles, file logic, folder merge, proxy |
| `npm run typecheck` | `tsc -b`, strict |
| `npm run build` | Typecheck, then a static site in `dist/` |
| `npm run preview` | Serves `dist/` locally (without the proxy; see below) |

## Testing

About 150 Vitest tests, next to the code they test (`*.test.ts`):

```bash
npm test
npx vitest            # watch mode
npx vitest src/api/sources   # one folder
```

- Clients and sources are tested against canned responses; `src/api/sources/fixtures/` holds saved HTML pages for
  TorrentGalaxy.
- Logic that can be tested without the DOM goes in `src/lib` or `src/api` with a test; pages and components stay thin.
- The proxy rules (`proxyTargets.ts`) are tested too, since both the dev server and the Pages Function depend on them.

Checking a change in the real app: run `npm run dev`, open the page the change touches, and sign in with put.io.
There is no demo mode; a put.io account is needed to see the library, and a TMDB token to see anything at all.

## Deploying

`npm run build` makes a static site in `dist/`; `public/_redirects` sends every path to the app.

Deploy to **Cloudflare Pages** so `functions/` runs too:

1. Create a Pages project from this repository.
2. Build command `npm run build`, output directory `dist`.
3. Set `VITE_TMDB_TOKEN` (and `VITE_TRAKT_CLIENT_ID`, `VITE_PUTIO_APP_ID` if you use your own) in the project's build
   environment variables.

Any static host works for everything else, but without the Pages Function The Pirate Bay, Knaben, TorrentGalaxy,
OpenSubtitles search, MyMoviz and the IMDb lists fail (the other sources, put.io, TMDB and playback still work).

`VITE_` values are built into the page, so anyone can read the TMDB token from a deployed site. TMDB read tokens are
meant for apps like this, but use a token made for the web app (not the native app's) so it can be replaced on its
own.

## Troubleshooting

| Problem | Fix |
|---|---|
| Blank page, "TMDB" errors in the console | `VITE_TMDB_TOKEN` is missing or is the short API key; use the Read Access Token and restart `npm run dev` |
| Port 5173 is in use, Vite picks another | Another dev server is running; stop it, or use the port Vite printed |
| A source added to `proxyTargets` answers 404 in development | Restart the dev server; the proxy list is read at start |
| The Pirate Bay, Knaben, TorrentGalaxy or OpenSubtitles fail on the deployed site | The host isn't running `functions/`; deploy to Cloudflare Pages |
| Signed out unexpectedly | put.io answered 401 (the sign-in was revoked or expired); sign in again |
| The library is empty after signing in | The first read is still matching; or the videos are in folders the library doesn't cover (Settings → put.io Folders), which still show in Files |
| Settings or the library reset on reload | localStorage is unavailable (private window, full storage); the app works but can't remember |

## Code conventions

- TypeScript, strict; no `any`. Every request through TanStack Query; no fetches inside components.
- Logic without React in `src/lib` and `src/api`, each with a test. Pages compose hooks and components.
- One CSS file per area in `src/styles/`; shared tokens in `src/styles.css`.
- The web app follows the native app's behaviour (folder names, Smart Get rules, settings) so a put.io library works
  the same in both; when they differ, say so in a comment and in `docs/FEATURES.md`.
- Never commit secrets; `.env.local` is ignored, but check `git status` before committing.
