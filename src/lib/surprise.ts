import type { CatalogItem, MediaKind } from "../api/tmdb";

/** "Surprise me": a random well-rated pick for a mood, avoiding recent repeats. Ported from the iPhone app's
 * SurpriseModel and Mood (AMDBKit/Discovery.swift); the network call is passed in so this stays testable. */

export type MoodID = "anything" | "laugh" | "thrill" | "feelGood" | "mindBending" | "cry" | "scare";

export interface Mood {
  id: MoodID;
  title: string;
  emoji: string;
  /** TMDB genre ids, OR-ed. Movie and TV genre lists differ, so each kind has its own. */
  genres: Record<MediaKind, number[]>;
}

export const moods: readonly Mood[] = [
  { id: "anything", title: "Anything", emoji: "🎲", genres: { movie: [], tv: [] } },
  { id: "laugh", title: "Laugh", emoji: "😂", genres: { movie: [35], tv: [35] } },
  { id: "thrill", title: "Thrill", emoji: "⚡️", genres: { movie: [53, 28], tv: [10759, 80] } },
  { id: "feelGood", title: "Feel good", emoji: "🥰", genres: { movie: [10751, 10749, 16], tv: [10751, 16] } },
  { id: "mindBending", title: "Mind-bending", emoji: "🌀", genres: { movie: [878, 9648], tv: [10765, 9648] } },
  { id: "cry", title: "Cry", emoji: "😢", genres: { movie: [18], tv: [18] } },
  // TMDB has no horror genre for TV; mystery is the iPhone app's stand-in.
  { id: "scare", title: "Scare me", emoji: "👻", genres: { movie: [27], tv: [9648] } },
];

/** A mood from a URL value, falling back to Anything. */
export const moodByID = (id: string | null | undefined): Mood => moods.find((m) => m.id === id) ?? moods[0];

/** Lowest TMDB rating a pick can have, and the votes needed for that rating to count. */
export const MIN_RATING = 6.5;
export const MIN_VOTES = 500;
/** How many recent picks to avoid repeating, and how many "Not feeling it?" options to offer. */
const RECENT_LIMIT = 20;
const ALTERNATIVES = 6;
/** Only the first pages of popular matches: further down, the picks get obscure. */
const MAX_PAGE = 10;

/** The /discover query for one page of a mood: popular first, rating and vote thresholds, genres OR-ed. */
export function discoverQuery(kind: MediaKind, mood: Mood, page: number): Record<string, string> {
  const query: Record<string, string> = {
    sort_by: "popularity.desc",
    "vote_average.gte": MIN_RATING.toFixed(1),
    "vote_count.gte": String(MIN_VOTES),
    page: String(page),
  };
  const genres = mood.genres[kind];
  if (genres.length) query.with_genres = genres.join("|");
  return query;
}

export interface DiscoverPage {
  items: CatalogItem[];
  totalPages: number;
}

export interface SurpriseState {
  pick?: CatalogItem;
  /** Other good matches for the same mood. */
  alternatives: CatalogItem[];
  /** Keys of recent picks, oldest first. */
  recent: string[];
  /** Nothing matched the mood. */
  empty: boolean;
}

export const initialSurprise: SurpriseState = { alternatives: [], recent: [], empty: false };

export const itemKey = (item: Pick<CatalogItem, "kind" | "tmdbID">) => `${item.kind}-${item.tmdbID}`;

/** A whole number in 0..<count. */
export type Random = (count: number) => number;
const defaultRandom: Random = (count) => Math.floor(Math.random() * count);

const remember = (recent: string[], key: string) => [...recent.filter((k) => k !== key), key].slice(-RECENT_LIMIT);

/** Rolls a new pick: page 1 tells how many pages there are, then a random page among the first ten is the pool.
 * Throws when page 1 can't be loaded; a failed later page falls back to page 1. */
export async function roll(state: SurpriseState, loadPage: (page: number) => Promise<DiscoverPage>, random: Random = defaultRandom): Promise<SurpriseState> {
  const first = await loadPage(1);
  let pool = first.items;
  const page = 1 + random(Math.max(1, Math.min(first.totalPages, MAX_PAGE)));
  if (page > 1) {
    const other = await loadPage(page).catch(() => undefined);
    if (other?.items.length) pool = other.items;
  }
  const fresh = pool.filter((i) => !state.recent.includes(itemKey(i)));
  const candidates = fresh.length ? fresh : pool;
  if (!candidates.length) return { ...state, pick: undefined, alternatives: [], empty: true };
  const pick = candidates[random(candidates.length)];
  const others = candidates.filter((i) => itemKey(i) !== itemKey(pick) && i.backdropPath);
  return { pick, alternatives: sample(others, ALTERNATIVES, random), recent: remember(state.recent, itemKey(pick)), empty: false };
}

/** Makes an alternative the pick; the old pick takes its place in the list. */
export function choose(state: SurpriseState, item: CatalogItem): SurpriseState {
  const index = state.alternatives.findIndex((i) => itemKey(i) === itemKey(item));
  if (!state.pick || index < 0) return state;
  const alternatives = [...state.alternatives];
  alternatives[index] = state.pick;
  return { ...state, pick: item, alternatives, recent: remember(state.recent, itemKey(item)) };
}

function sample<T>(items: T[], count: number, random: Random): T[] {
  const pool = [...items];
  const result: T[] = [];
  while (result.length < count && pool.length) result.push(pool.splice(random(pool.length), 1)[0]);
  return result;
}
