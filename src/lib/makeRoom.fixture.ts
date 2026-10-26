import type { PutioFile } from "../api/putio";
import type { LibraryEntry, LibraryMatch } from "./library";
import type { RoomRules } from "./makeRoom";

/** The same library as the native MakeRoomPlannerTests:
 *
 *     movies/                     (10)
 *       Old Movie (2001)/old.mkv  (11 / 111)  movie 1, watched, added 2026-01-01
 *       loose.mkv                 (12)        movie 2, added 2026-02-01
 *       Watching (2020)/w.mkv     (13 / 131)  movie 3, at 10 minutes
 *       Listed/l.mkv              (14 / 141)  movie 4, on My List
 *       Collection/a.mkv, b.mkv   (15 / 151, 152)  movies 5 and 6 in one folder
 *      TV Series                  (20)
 *       Show/                     (21)
 *         Season 1/ e1, e2        (22 / 221, 222)  show 100 S1, watched
 *         Season 2/ e1            (23 / 231)       show 100 S2, watched
 *         S03E01, S03E02          (211, 212)       loose in the show folder
 *     Other/other.mkv             (30 / 301)
 *     top.mkv                     (5)  */
export const folder = (id: number, name: string, parent: number, size?: number, added = "2025-01-01T00:00:00"): PutioFile =>
  ({ id, name, file_type: "FOLDER", parent_id: parent, size, created_at: added });

const movie = (id: number): LibraryMatch => ({ tmdbID: id, kind: "movie", title: `Movie ${id}`, posterPath: `/m${id}.jpg` });
const episode = (season: number, ep: number): LibraryMatch => ({ tmdbID: 100, kind: "tv", season, episode: ep, title: "Show", posterPath: "/show.jpg" });
export const video = (id: number, name: string, parent: number, size: number | undefined, added: string, match?: LibraryMatch): LibraryEntry =>
  ({ id, name, parentID: parent, size, createdAt: added, startFrom: 0, match });

export const folders: PutioFile[] = [
  folder(10, "movies", 0),
  folder(11, "Old Movie (2001)", 10, 4100, "2026-01-01T00:00:00"),
  folder(13, "Watching (2020)", 10, 3000, "2025-12-01T00:00:00"),
  folder(14, "Listed", 10, 2000, "2025-11-01T00:00:00"),
  folder(15, "Collection", 10, 2000, "2025-10-01T00:00:00"),
  folder(20, " TV Series ", 0),
  folder(21, "Show", 20, 10_500, "2025-06-01T00:00:00"),
  folder(22, "Season 1", 21, 6000, "2025-06-01T00:00:00"),
  folder(23, "Season 2", 21, 2500, "2025-07-01T00:00:00"),
  folder(30, "Other", 0, 900),
];

export const entries: LibraryEntry[] = [
  video(111, "old.mkv", 11, 4000, "2026-01-01T00:00:00", movie(1)),
  video(12, "loose.mkv", 10, 1500, "2026-02-01T00:00:00", movie(2)),
  video(131, "w.mkv", 13, 3000, "2025-12-01T00:00:00", movie(3)),
  video(141, "l.mkv", 14, 2000, "2025-11-01T00:00:00", movie(4)),
  video(151, "a.mkv", 15, 1000, "2025-10-01T00:00:00", movie(5)),
  video(152, "b.mkv", 15, 1000, "2025-10-02T00:00:00", movie(6)),
  video(221, "S01E01.mkv", 22, 3000, "2025-06-01T00:00:00", episode(1, 1)),
  video(222, "S01E02.mkv", 22, 3000, "2025-06-01T00:00:00", episode(1, 2)),
  video(231, "S02E01.mkv", 23, 2500, "2025-07-01T00:00:00", episode(2, 1)),
  video(211, "S03E01.mkv", 21, 1000, "2025-08-01T00:00:00", episode(3, 1)),
  video(212, "S03E02.mkv", 21, 1000, "2025-08-02T00:00:00", episode(3, 2)),
  video(301, "other.mkv", 30, 900, "2020-01-01T00:00:00", movie(7)),
  video(5, "top.mkv", 0, 800, "2020-01-01T00:00:00", movie(8)),
];

export const rules: RoomRules = { watched: new Set([111, 221, 222, 231]), positions: new Map([[131, 600]]), myList: new Set(["movie-4"]) };
