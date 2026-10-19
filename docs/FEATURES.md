# Features

Everything the web version of Putio & Chill does, by area. It is a port of the
[native app](https://github.com/AmirhosseinKhanlari/putio-and-chill) for iPhone, iPad and Apple TV; the last section
lists what the web version leaves out.

- [Getting started](#getting-started)
- [Home and browsing](#home-and-browsing)
- [Titles and people](#titles-and-people)
- [Coming Up](#coming-up)
- [Search](#search)
- [Surprise Me](#surprise-me)
- [Getting releases](#getting-releases)
- [IMDb Watchlist](#imdb-watchlist)
- [Library, Files and Trash](#library-files-and-trash)
- [Playback](#playback)
- [Subtitles](#subtitles)
- [Settings](#settings)
- [Not in the web version](#not-in-the-web-version)

## Getting started

- **put.io sign-in**: a short code to enter at put.io/link, the same as on Apple TV, so the app never sees a password.
  The app polls put.io until the code is used; an expired code can be replaced with one click.
- **Optional accounts**: chill.institute (its indexers as a release source, and its Latest lists) and an
  OpenSubtitles API key (subtitle search in the player). Both live in Settings and stay in this browser.
- **Nothing to install**: a static site, served from Cloudflare Pages or any host, that works on a phone-sized window
  as well as a desktop one.

## Home and browsing

<img src="images/home.jpg" width="100%" alt="Home">

- **Featured slider**: trending titles with full-bleed art, year, rating and actions; advances every nine seconds.
- **Surprise me** card right under it.
- **Continue Watching**: one card per movie or show, with the time left, from put.io's own watch positions.
- **My List**: save anything with ＋; See All page.
- **Recently Added to put.io**, on Home and per kind on Movies and TV.
- **Trending Now**, **Popular Movies**, **Popular TV**, and **Because you watched …**: recommendations from the last
  title you played.
- **Latest Movies / Latest Shows**: MyMoviz's newest, plus chill.institute's lists when connected.
- **IMDb Watchlist** row when a link is set in Settings.
- **Movies / TV** pages: a featured slider for the kind, Recently Added, **IMDb Top 250** (movies or shows, with
  ranks, marked when already in put.io), Popular, **New on Netflix**, **New on Disney+**, **New Series**,
  **Returning This Week**, **Critically Acclaimed**, Top Rated, and a row per genre.
- Every row has **See all**: a full page of the list, loaded endlessly.
- **First load**: the library is read from put.io and each video matched to TMDB; the matched titles appear as they
  are found, never raw file names, and the result is kept in the browser for next time.

## Titles and people

<img src="images/title.jpg" width="100%" alt="Title page">

- **Title page**: full-bleed art, year, runtime, genres, TMDB rating, an IMDb link, overview, trailer (YouTube,
  without cookies), cast and crew with round photos, More Like This.
- **Smart action button**: Get & Watch, Play, or Resume with the time left; "Getting…" while a release is on its way.
- **Versions** for every movie, season and episode.
- **Shows**: seasons, episode list with stills, air dates and ratings, the season's best episode marked, **Get season**,
  and for each episode a ⋯ menu: play, play from the start, and **Choose a Version…**. When put.io has several copies of
  an episode, each is listed.
- **People**: photo, details, biography, Known For, and the full filmography with Movies / Shows filters.
- **In put.io** badge wherever a title already has a file.

## Coming Up

<img src="images/coming-up.jpg" width="100%" alt="Coming Up">

- **Movies**: this weekend's US box office top 10 with grosses (Trakt), In Cinemas Now, and Coming Soon to Cinemas
  with release dates.
- **TV**: next episodes of the shows in your put.io and My List, grouped Today, Tomorrow, weekday, then by date;
  plus Premiering Soon and Returning This Week.

## Search

- **Search** movies, shows and people, with results as you type; recent searches are remembered (the last eight).
- **Search releases for "…"** for anything TMDB doesn't know: the sources are asked directly and the result opens in
  Versions.

## Surprise Me

<img src="images/surprise.jpg" width="100%" alt="Surprise Me">

- Pick **Movies** or **Series** and a mood: Anything, Laugh, Thrill, Feel good, Mind-bending, Cry, Scare me.
- Tonight's pick is well rated (TMDB 6.5 or better with at least 500 votes), with six alternatives and **Shuffle**.
- **Watch This** opens the title page; ＋ adds it to My List.

## Getting releases

- **Get & Watch**: searches every enabled source at once, picks the best release by your Smart Get rule
  (resolution, largest size, most seeders; never a camera copy, never one nobody seeds), and sends it to put.io.
  With **One-tap Get** off, it opens Versions instead so you pick.
- **Versions**: every release found, best first, with a quality filter (4K / 1080p / 720p / …, only the qualities
  found), seeders, size and source; the same torrent found on several sources is one row with the most seeders any
  of them reports. Releases already in put.io are marked.
- **Sources**: chill.institute (with a chill account), YTS, EZTV, The Pirate Bay (apibay), Knaben, Torrents.csv,
  TorrentGalaxy; each can be turned off in Settings. A source that doesn't answer in 12 seconds is skipped.
- **Transfers**: progress, speed and status in Library; a failed transfer says why. A **Ready to watch** toast when
  done, and a title you asked for while its page is open counts down and plays (Auto-play when ready).
- **put.io folders**: downloads go to `Movies` and `TV Series/<Show>/Season N` at the top of put.io (found ignoring
  case, created when missing), or to folders you pick in Settings. Libraries from older builds that used
  `AMDB/Movies` and `AMDB/TV` are merged into these once, per put.io account.

## IMDb Watchlist

- Settings → Connected Services → IMDb: paste your IMDb profile or watchlist link (the watchlist must be public).
- The watchlist shows as a row on Home and as a full page; every title opens its page with Get & Watch. Read-only.

## Library, Files and Trash

- **Library**: every video in Movies, TV Series, your picked folders and loose at the top of put.io, matched to TMDB,
  as posters with filters (All, Movies, TV, Other), a storage meter (used, free, in Trash), transfers in progress,
  Update Now, and delete.
- **Kept in the browser**: opens instantly from the last load, then updates from put.io at your chosen interval
  (Settings) and on demand.
- **Files**: the whole put.io, folder by folder. Play videos, download the original, rename, move, copy, delete,
  create folders, and search every folder at once. **Select** moves, copies or deletes several at a time. Sort by
  name, newest or largest.
- **Trash**: deleted files wait in put.io's trash. Restore them, delete them for good, or Empty Trash to free the
  space.

## Playback

- **Streaming**: put.io's HLS stream through hls.js (or the browser's own player where HLS is native, as in Safari).
- **Controls**: scrubber, play/pause, ±10 s skip, speed, audio track, subtitles, Picture in Picture, full screen.
- **Keyboard**: space or K play/pause, ← → skip 10 s, F full screen, M mute, < > speed, Esc closes.
- **Resume** where you left off, synced with put.io so it continues in the native app too.
- **Next episode**: a Next Episode card near the end with a countdown and Watch Credits; optional auto-play when the
  next episode is in put.io. The countdown waits while the video is paused.
- **Errors in plain words**: "put.io couldn't stream this video right now" or "This video can't play in the browser".

## Subtitles

- One Subtitles menu with **put.io's tracks** and **OpenSubtitles** search (with your API key from Settings),
  matching this exact file first when possible.
- **Timing**: show earlier or later in 0.5 s steps, remembered per file.
- **Style**: size, background, color and typeface, drawn by the app so it applies to every subtitle; a live preview in
  Settings.
- **Preferred language** from Settings is turned on automatically; your per-file choice (including Off) is remembered,
  and downloaded subtitles are cached so re-watching never spends another download.

## Settings

Settings is a hub of pages, as in the native app; the open page is in the address (`?page=…`).

- **Playback**: auto-play when ready, auto-play next episode, audio language.
- **Subtitles**: language, style with a preview, OpenSubtitles API key.
- **Smart Get**: one-tap Get, quality, max size, the quality Versions shows first.
- **Sources**: on/off for each release source, with what each is good for.
- **Library**: update automatically, how often (never more often than every 5 minutes), Update Now, last updated.
- **put.io Folders**: Movies and TV folders picked by browsing put.io, season folders, or the defaults.
- **Connected Services**: chill.institute, IMDb watchlist link.
- **About**.

## Not in the web version

Things a browser can't do, or that only make sense on a device, stay in the
[native app](https://github.com/AmirhosseinKhanlari/putio-and-chill): offline downloads, Siri, Spotlight, widgets,
Live Activities, Control Center, Top Shelf, Ask Chill, new-episode notifications, MDBList ratings (Rotten Tomatoes,
Metacritic, Letterboxd), Organize library and Clean Up, and settings shared through iCloud Keychain. Settings here are
per browser.
