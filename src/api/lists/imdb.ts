/** A public IMDb watchlist or list, in IMDb's order, read through IMDb's GraphQL API (no sign-in for public lists;
 * read-only). IMDb only allows browser requests from its own sites, so this goes through the app's proxy. */
import type { ListTitle } from "./titles";

const PROXY = "/proxy/imdb/";
const headers = {
  "Content-Type": "application/json",
  "x-imdb-client-name": "imdb-web-next-localized",
  "x-imdb-user-country": "US",
  "x-imdb-user-language": "en-US",
};

export type IMDbListRef =
  | { type: "watchlist"; userID: string }
  /** IMDb's newer profile links (imdb.com/user/p.e4i6…/watchlist), looked up to their user id. */
  | { type: "profileWatchlist"; profileID: string }
  | { type: "list"; id: string };

/** From a link or id: imdb.com/user/ur123/watchlist, imdb.com/user/p.abc12345/watchlist, ur123, imdb.com/list/ls456,
 * ls456. undefined when there's no IMDb user or list in it. */
export function parseIMDbRef(text: string | null | undefined): IMDbListRef | undefined {
  const trimmed = text?.trim() ?? "";
  const list = /\bls\d{5,}\b/.exec(trimmed)?.[0];
  if (list) return { type: "list", id: list };
  const user = /\bur\d{5,}\b/.exec(trimmed)?.[0];
  if (user) return { type: "watchlist", userID: user };
  const profile = /(?<![a-z0-9])p\.[a-z0-9]{8,}/i.exec(trimmed)?.[0];
  if (profile) return { type: "profileWatchlist", profileID: profile.toLowerCase() };
  return undefined;
}

export class IMDbPrivateError extends Error {
  constructor() {
    super("This IMDb list is private. Make it public on imdb.com to see it here.");
  }
}

const clean = (id: string) => id.replace(/[^a-z0-9.]/gi, "");

interface GraphResponse<T> { data?: T; errors?: { extensions?: { isRetryable?: boolean } }[] }
interface Title { id: string; titleText?: { text?: string }; titleType?: { id?: string }; releaseYear?: { year?: number | null } }
interface ListData {
  list?: { titleListItemSearch?: { total?: number; pageInfo?: { hasNextPage?: boolean; endCursor?: string }; edges?: { listItem?: Title }[] } } | null;
}

async function post<T>(query: string): Promise<GraphResponse<T>> {
  const response = await fetch(PROXY, { method: "POST", headers, body: JSON.stringify({ query }) });
  if (!response.ok) throw new Error(`IMDb ${response.status}`);
  return response.json() as Promise<GraphResponse<T>>;
}

/** IMDb's types: movie, tvSeries, tvMiniSeries, tvMovie, short… Series are shows; everything else is a movie. */
export const isShowType = (type?: string) => Boolean(type && type.toLowerCase().startsWith("tv") && type !== "tvMovie" && type !== "tvSpecial" && type !== "tvShort");

export function parseListPage(data: ListData): { titles: ListTitle[]; next?: string } | undefined {
  const search = data.list?.titleListItemSearch;
  if (!search) return undefined;
  const titles = (search.edges ?? []).flatMap(({ listItem: t }) => (t?.titleText?.text
    ? [{ kind: isShowType(t.titleType?.id) ? "tv" as const : "movie" as const, title: t.titleText.text, year: t.releaseYear?.year ?? undefined, imdbID: t.id, source: "imdb" }]
    : []));
  return { titles, next: search.pageInfo?.hasNextPage ? search.pageInfo.endCursor : undefined };
}

async function userID(profileID: string): Promise<string> {
  const r = await post<{ userProfile?: { userId?: string } }>(`{ userProfile(input: {profileId: "${clean(profileID)}"}) { userId } }`);
  const id = r.data?.userProfile?.userId;
  if (!id) throw new IMDbPrivateError();
  return id;
}

/** Every title on the list (up to `limit`), 250 a request. */
export async function imdbListTitles(ref: IMDbListRef, limit = 1000): Promise<ListTitle[]> {
  const root = ref.type === "list"
    ? `list(id: "${clean(ref.id)}")`
    : `predefinedList(classType: WATCH_LIST, userId: "${clean(ref.type === "watchlist" ? ref.userID : await userID(ref.profileID))}")`;
  const titles: ListTitle[] = [];
  let cursor: string | undefined;
  do {
    const after = cursor ? `, after: "${cursor.replace(/"/g, "")}"` : "";
    const query = `{ list: ${root} { titleListItemSearch(first: 250${after}) { total pageInfo { hasNextPage endCursor } `
      + "edges { listItem: title { id titleText { text } titleType { id } releaseYear { year } } } } } }";
    let r = await post<ListData>(query);
    // IMDb occasionally answers "try again": once more before giving up.
    if (!r.data?.list && r.errors?.some((e) => e.extensions?.isRetryable)) {
      await new Promise((done) => setTimeout(done, 1000));
      r = await post<ListData>(query);
    }
    const page = r.data && parseListPage(r.data);
    if (!page) throw new IMDbPrivateError();
    titles.push(...page.titles);
    cursor = page.next;
  } while (cursor && titles.length < limit);
  return titles.slice(0, limit);
}
