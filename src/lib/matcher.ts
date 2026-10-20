/** Picks the TMDB result a file name means (port of the iPhone app's LibraryMatcher). */
import { titleWords } from "./showTitle";

export interface Candidate {
  title: string;
  year?: number;
}

export function normalizeTitle(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** The exact title (and year, within one) first, then the exact title, then a year-matching first result. */
export function pickMatch<T extends Candidate>(items: T[], title: string, year?: number): { item: T; confidence: number } | undefined {
  const wanted = normalizeTitle(title);
  const yearOK = (item: T) => (year === undefined ? true : item.year !== undefined && Math.abs(item.year - year) <= 1);
  const exact = items.find((i) => normalizeTitle(i.title) === wanted && yearOK(i));
  if (exact) return { item: exact, confidence: 1 };
  const titleOnly = items.find((i) => normalizeTitle(i.title) === wanted);
  if (titleOnly) return { item: titleOnly, confidence: 0.7 };
  if (year !== undefined && items[0] && yearOK(items[0])) return { item: items[0], confidence: 0.5 };
  return undefined;
}

export interface ShowCandidate extends Candidate {
  tmdbID: number;
}

const yearFits = (item: Candidate, year: number) => item.year !== undefined && Math.abs(item.year - year) <= 1;

/** The show a TV file belongs to (port of the iPhone app's LibraryMatcher.pickShow). TV is searched without the
 * year (a show's first-air year rarely matches the year in an episode's name), then picked with it:
 * - a same-title show from that year (±1);
 * - else the one longer "Title: …" show from exactly that year ("Monster" 2025 → "Monster: The Ed Gein Story"); two
 *   such shows that year are too close to call;
 * - else a same-title show from another year (or for a name without a year) only when it has the file's season:
 *   TMDB's anime "Monster" (2004, one season) isn't the home of "Monster S03". A failed season count rules nothing out.
 * Nothing fits: no match (Fix Match can set one). */
export async function pickShow<T extends ShowCandidate>(
  items: T[], title: string, year: number | undefined, season: number, seasonCount: (tmdbID: number) => Promise<number | undefined>,
): Promise<{ item: T; confidence: number } | undefined> {
  const wanted = normalizeTitle(title);
  const exact = items.filter((i) => normalizeTitle(i.title) === wanted);
  if (year !== undefined) {
    const fits = exact.find((i) => yearFits(i, year));
    if (fits) return { item: fits, confidence: 1 };
    const words = titleWords(title);
    const longer = items.filter((i) => i.year === year && i.title.includes(":") && startsWithWords(titleWords(i.title), words));
    if (longer.length === 1) return { item: longer[0], confidence: 0.6 };
  }
  for (const candidate of exact) {
    if (season > 1) {
      const count = await seasonCount(candidate.tmdbID).catch(() => undefined);
      if (count !== undefined && count < season) continue;
    }
    return { item: candidate, confidence: year === undefined ? 1 : 0.6 };
  }
  return undefined;
}

const startsWithWords = (words: string[], prefix: string[]) => prefix.length > 0 && prefix.length <= words.length && prefix.every((w, i) => words[i] === w);
