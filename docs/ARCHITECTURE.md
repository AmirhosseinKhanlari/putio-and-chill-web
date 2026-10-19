# Architecture

Putio & Chill on the web is a single-page React app: pages and components on top of a logic layer ported from the
native app's Swift package, talking to put.io, TMDB and the release sources straight from the browser, with a small
same-origin proxy for the few services that don't allow that.

```
┌──────────────── Pages and components ───────────────┐
│ Home · Movies · TV · Coming Up · Search · Library     │  React 18, React Router,
│ Files · Trash · Title · Person · Surprise · Player    │  TanStack Query, hls.js
│ Settings · Sign in                                    │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────── State (src/state) ──────────────────┐
│ Session (put.io and chill sign-ins) · account,        │  Hooks over Query and
│ library, transfers, My List, toasts, old-folder merge │  localStorage
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────── Logic (src/lib, src/api) ───────────┐
│ putio · tmdb · lists · people · opensubtitles · chill │  Clients, release sources,
│ sources/ (YTS, EZTV, apibay, Knaben, Torrents.csv,    │  parsers, matcher, library
│ TorrentGalaxy; aggregator; proxy allow-list)          │  index, Smart Get, settings
│ releaseName · matcher · library · smartGet · folders  │
└──────────────────────────┬──────────────────────────┘
                           │  /proxy/<name>/…
┌──────────────── Proxy ──────────────────────────────┐
│ vite.config.ts (dev) · functions/proxy (production)  │  One allow-list, same rules
└─────────────────────────────────────────────────────┘
```

- **TypeScript throughout**, strict. Logic modules are plain functions and small classes with no React in them, so
  they are tested directly with Vitest.
- **No backend**: every request goes from the browser to the service (or through the proxy for the ones that block
  browsers). Sign-ins and settings are in the visitor's localStorage.
- **Vite** builds a static site; the only server code is the Cloudflare Pages Function for the proxy.

## Modules

### `src/api`

| File | What's in it |
|---|---|
| `putio.ts` | put.io API: files, folders, search, transfers, streaming URLs (HLS), subtitles, account, trash, OAuth device codes |
| `tmdb.ts` | TMDB: search, details with credits and videos, seasons, discover, trending, images |
| `people.ts` | TMDB people: details, Known For, filmography |
| `lists/` | `tmdbLists.ts` (curated lists: New on Netflix, Returning This Week, …; genres; dated releases), `trakt.ts` (IMDb Top 250 and the box office), `mymoviz.ts` and `chillCatalog.ts` (Latest Movies / Shows), `imdb.ts` (watchlist), `queries.ts` (the Query hooks over them), `titles.ts` (resolving names to TMDB titles) |
| `chill.ts` | chill.institute: sign-in through put.io, and its search as a release source |
| `opensubtitles.ts` | OpenSubtitles search and download (through the proxy), file hash |
| `surprise.ts` | Surprise Me picks from TMDB discover |
| `sources/` | One module per release source, `magnet.ts` (magnet links from info-hashes), `types.ts`, `index.ts` (the aggregator), `proxyTargets.ts` (the proxy allow-list and header rules, shared with the server) |

### `src/lib`

| File | Role |
|---|---|
| `releaseName.ts` | Title, year, season/episode, resolution, codec and source from release and file names |
| `matcher.ts` | Matches a parsed name to TMDB search results with a confidence score |
| `library.ts`, `libraryScope.ts` | The library index: which put.io folders count, walking them, matching each video once, watch positions and durations, Continue Watching |
| `smartGet.ts` | The Get & Watch rule: which release to send |
| `folders.ts` | put.io folder layout (`Movies`, `TV Series/<Show>/Season N`), finding or creating folders |
| `folderMerge.ts`, `folderMergeRun.ts` | The one-time merge of the old `AMDB/…` folders: a pure planner and the runner that calls put.io |
| `settings.ts` | The settings model and store (the native app's AppSettings, minus what only a device can do) |
| `storage.ts` | Typed localStorage wrappers that never throw; the storage keys |
| `format.ts`, `surprise.ts` | Formatting helpers; Surprise Me moods and thresholds |

### `src/state`

- `session.tsx`: put.io and chill.institute tokens, sign in and out. A put.io 401 anywhere signs the visitor out.
- `hooks.tsx`: account, library, transfers, My List, toasts, and the old-folder merge.
- `oldFolderMerge.ts`: runs the merge once per put.io account, remembering where it stopped.

### Pages and components

- `pages/`: one file per route (see `App.tsx`). `Home.tsx` also holds `Browse`, the Movies and TV pages. The player is
  lazy-loaded so hls.js is only fetched when something plays.
- `components/`: `Hero`, `Shelf` and `Cards` (every row on every page), `GetAndWatch` (the Get & Watch hook and the
  Versions dialog), `TopBar`, `player/` (subtitle menu and overlay, audio/speed menus, Next Up card),
  `files/` (dialogs, menus, folder picker, the pure list logic), `settings/` (the pages, controls, subtitle style
  editor, folder picker).

## The proxy

Some services don't allow browser requests: apibay.org, api.knaben.org, OpenSubtitles, IMDb's GraphQL API,
mymoviz.co, torrentgalaxy.info. For those, the site has a same-origin proxy: `/proxy/<name>/<path>` goes to that
name's address in `src/api/sources/proxyTargets.ts`, and nowhere else.

- Only GET, HEAD and POST (GET and HEAD for mymoviz and torrentgalaxy) and a few headers (Accept, Accept-Language,
  Content-Type, Authorization, plus each target's own) are passed on; cookies, origin and referrer are not.
- Only the body, status and content type come back; `Set-Cookie` is dropped, so it can't set cookies on this site.
- torrentgalaxy is a browser site, so the proxy sends it a browser User-Agent and Accept.
- `/proxy/opensubtitles/file?url=…` fetches one subtitle file, only from https links on opensubtitles.com /
  opensubtitles.org (400 otherwise).
- Unknown names answer 404, disallowed methods 405, in both environments.

Two implementations, one list: `vite.config.ts` sets it up on the dev server (restart it after changing the list);
`functions/proxy/[[path]].ts` is the Cloudflare Pages Function doing the same in production. To add a service, add a
name and base address to `proxyTargets` (and any headers it needs).

## Data flow examples

**Opening the app**
1. `library.ts` shows the saved library from localStorage immediately.
2. If automatic updates are on and the last load is older than the Settings interval, put.io is read again:
   Movies, TV Series, the picked folders and the loose videos at the top.
3. New file names are parsed and matched to TMDB (once per name); matched titles appear as they are found.
4. The pages load their TMDB, Trakt, MyMoviz and chill rows through TanStack Query.

**Get & Watch**
1. The title page builds a target (TMDB item, IMDb id, season/episode).
2. `sources/index.ts` asks every enabled source in parallel (12 s each), builds magnet links, merges duplicates and
   filters to the episode, season pack or movie asked for.
3. `smartGet.ts` picks a release by the rule; `putio.ts` adds it to the right folder (`folders.ts`).
4. Library polls put.io every 5 seconds while open; when the transfer finishes it refreshes the library and shows a toast, and the open title page counts
   down and plays when Auto-play when ready is on.

**Playing**
1. The player fetches put.io's HLS URL and plays it with hls.js (native HLS where the browser has it).
2. Progress is saved to put.io (`start_from`) and locally, so resume works here and in the native app.
3. `player/useSubtitles.ts` lists put.io's tracks and OpenSubtitles results, restores the file's choice and timing,
   and `SubtitleOverlay` draws the cues in the chosen style.

## Caching and refresh

| Data | Stored | Refreshed |
|---|---|---|
| put.io library, matches, durations | localStorage (`pc.library.v1`, `pc.matches.v1`, `pc.durations.v1`) | At load if older than the Settings interval (default 1 h); Update Now; when a transfer finishes |
| Settings, My List, recent searches, sign-ins | localStorage (`pc.settings.v1`, `pc.mylist.v1`, …) | On change |
| TMDB rows, charts, Coming Up, Latest | TanStack Query (memory) | Per query `staleTime`: trending and lists a day, recommendations an hour, account 30 s |
| Transfers | Query, polled | Every 5 seconds while Library is open |
| Subtitles and per-file choices | localStorage | Kept; re-watching never spends another download |
| Artwork | Browser HTTP cache | Browser-managed |

localStorage can be unavailable (private windows, full storage); every read falls back to a default and every write
is best-effort, so the app still works and just forgets on reload.

## Platform notes

- **Secrets**: `VITE_` values are built into the page, so anyone can read the TMDB token and Trakt client id from a
  deployed site. Both are read-only keys meant for client apps; use ones made for the web app so they can be replaced
  on their own. put.io and chill.institute sign-ins never leave the visitor's browser.
- **Routing**: `public/_redirects` sends every path to `index.html`, so deep links work on Cloudflare Pages.
- **Layout**: one CSS file per area, responsive down to phone widths; shelf arrows hide on touch screens and the hero
  animation respects reduced motion.
