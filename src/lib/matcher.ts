/** Picks the TMDB result a file name means (port of the iPhone app's LibraryMatcher). */
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
