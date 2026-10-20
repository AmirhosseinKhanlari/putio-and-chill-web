/** What Get & Watch searches sources for, and what it says when it can't or finds nothing (the iPhone app's
 * TitleModel.query and VersionsModel.emptyHint). An IMDb id is optional: shows TMDB has none for are searched by
 * title. */
import type { SourceFailure } from "../api/sources";
import { queryIMDbID, searchText, type ReleaseQuery } from "../api/sources/types";
import type { CatalogItem } from "../api/tmdb";

export interface GetTarget {
  item: CatalogItem;
  imdbID?: string;
  season?: number;
  episode?: number;
  /** Free text from Search ("Search releases for …"): every release that matches, not one title. */
  text?: string;
}

/** The query for a target; undefined only without a title (still loading) or for a show with no season picked. */
export function releaseQuery(t: GetTarget): ReleaseQuery | undefined {
  if (t.text) return { kind: "text", text: t.text };
  const title = t.item.title.trim();
  if (!title) return undefined;
  const imdbID = t.imdbID || undefined;
  if (t.item.kind === "movie") return { kind: "movie", title, year: t.item.year, imdbID };
  if (t.season === undefined) return undefined;
  return t.episode !== undefined ? { kind: "episode", title, imdbID, season: t.season, episode: t.episode } : { kind: "season", title, imdbID, season: t.season };
}

/** Why `releaseQuery` gave nothing, in words for the user. */
export function noQueryMessage(t: GetTarget): string {
  if (!t.text && !t.item.title.trim()) return "Still loading this title. Try again in a moment.";
  return "Pick a season or an episode to search for.";
}

/** "No versions found." with why it may be: searched by name (no IMDb id), and which sources didn't answer. */
export function noVersionsMessage(query: ReleaseQuery | undefined, failures: SourceFailure[] = []): string {
  const parts = ["No versions found."];
  if (query && query.kind !== "text" && !queryIMDbID(query)) {
    parts.push(`This title has no IMDb id yet, so sources were searched by name (“${searchText(query)}”).`);
  }
  if (failures.length) parts.push(failures.map((f) => f.message).join(" "));
  parts.push("Try again later, or turn on more sources in Settings.");
  return parts.join(" ");
}
