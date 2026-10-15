import { items, tmdbGet, type CatalogItem, type RawItem } from "./tmdb";

/** An actor or filmmaker, with everything they worked on (TMDB person + combined_credits). Ported from the iPhone
 * app's CatalogClient.person. */

export interface Credit {
  item: CatalogItem;
  /** Characters played and jobs done on this title, e.g. ["Director", "Writer"]. */
  roles: string[];
}

export interface PersonDetail {
  id: number;
  name: string;
  biography: string;
  profilePath?: string | null;
  department?: string;
  birthday?: string;
  deathday?: string;
  placeOfBirth?: string;
  /** Every title, newest first, undated last. */
  credits: Credit[];
  /** Their most-voted titles. */
  knownFor: CatalogItem[];
}

interface RawCredit extends RawItem {
  character?: string;
  job?: string;
  vote_count?: number;
  genre_ids?: number[];
}

export interface RawPerson {
  id: number;
  name: string;
  biography?: string | null;
  profile_path?: string | null;
  known_for_department?: string | null;
  birthday?: string | null;
  deathday?: string | null;
  place_of_birth?: string | null;
  combined_credits?: { cast?: RawCredit[]; crew?: RawCredit[] };
}

/** Talk shows and news: guest spots there top the vote counts but aren't what anyone is known for. */
const notKnownFor = new Set([10767, 10763]);
const KNOWN_FOR = 10;

export async function personDetail(id: number): Promise<PersonDetail> {
  return parsePerson(await tmdbGet<RawPerson>(`person/${id}`, { append_to_response: "combined_credits" }));
}

export function parsePerson(raw: RawPerson): PersonDetail {
  const all = [...(raw.combined_credits?.cast ?? []), ...(raw.combined_credits?.crew ?? [])];
  // One entry per title: an actor-director's film lists both the character and the job.
  const byKey = new Map<string, { credit: Credit; date?: string; votes: number; order: number; talk: boolean }>();
  for (const c of all) {
    const item = items([c])[0];
    if (!item) continue; // media_type "person" or missing
    const key = `${item.kind}-${item.tmdbID}`;
    const role = (c.character ?? c.job ?? "").trim();
    const entry = byKey.get(key) ?? {
      credit: { item, roles: [] }, date: c.release_date || c.first_air_date || undefined, votes: 0, order: byKey.size,
      talk: (c.genre_ids ?? []).some((g) => notKnownFor.has(g)),
    };
    if (role && !entry.credit.roles.includes(role)) entry.credit.roles.push(role);
    entry.votes = Math.max(entry.votes, c.vote_count ?? 0);
    byKey.set(key, entry);
  }
  const entries = [...byKey.values()];
  const newestFirst = [...entries].sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return a.order - b.order;
  });
  const knownFor = entries.filter((e) => !e.talk).sort((a, b) => b.votes - a.votes || a.order - b.order).slice(0, KNOWN_FOR);
  return {
    id: raw.id,
    name: raw.name,
    biography: raw.biography?.trim() ?? "",
    profilePath: raw.profile_path,
    department: raw.known_for_department || undefined,
    birthday: raw.birthday || undefined,
    deathday: raw.deathday || undefined,
    placeOfBirth: raw.place_of_birth || undefined,
    credits: newestFirst.map((e) => e.credit),
    knownFor: knownFor.map((e) => e.credit.item),
  };
}

/** "1970-07-30" → "July 30, 1970" (read as a calendar date, so no time zone can shift the day). */
export function longDate(iso?: string): string | undefined {
  const match = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** The line under the name: department · born · place (· died), as on the iPhone. */
export function personMeta(person: Pick<PersonDetail, "department" | "birthday" | "deathday" | "placeOfBirth">): string {
  const born = longDate(person.birthday);
  const died = longDate(person.deathday);
  return [person.department, born && `Born ${born}`, person.placeOfBirth, died && `Died ${died}`].filter(Boolean).join(" · ");
}
