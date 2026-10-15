import { discoverQuery, type DiscoverPage, type Mood } from "../lib/surprise";
import { items, tmdbGet, type MediaKind, type RawItem } from "./tmdb";

/** One page of well-rated TMDB matches for a mood ("Surprise me"). */
export async function discoverPage(kind: MediaKind, mood: Mood, page: number): Promise<DiscoverPage> {
  const raw = await tmdbGet<{ results?: RawItem[]; total_pages?: number }>(`discover/${kind}`, discoverQuery(kind, mood, page));
  return { items: items(raw.results ?? [], kind), totalPages: raw.total_pages ?? page };
}
