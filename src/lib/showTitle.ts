/** Comparing a release's title with a movie or show title (the iPhone app's MediaQuery.searchTitle and
 * ReleaseRelevance.sameShow / words). Used to search sources by name and to keep only the show asked for. */

/** Release names leave punctuation out ("Monster: The Ed Gein Story" → "Monster The Ed Gein Story"), and so must the
 * search, or sites that match every word find nothing. Apostrophes join ("Grey's" → "Greys"). */
export function searchTitle(title: string): string {
  return title
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** "www.UIndex.org - Severance" → "Severance": some uploads lead with the site they came from. */
export function withoutSitePrefix(title: string): string {
  return title.replace(/^\s*(?:www\.)?[A-Za-z0-9-]+\.(?:org|com|net|to|io|me|cc|tv|xyz|se)\s*[-–]+\s*/i, "");
}

/** Lowercased words without accents or punctuation, "&" as "and", apostrophes joined, a leading article dropped. */
export function titleWords(title: string): string[] {
  const folded = title.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "").replace(/&/g, " and ");
  const words = folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length > 1 && ["the", "a", "an"].includes(words[0])) words.shift();
  return words;
}

/** Whether a release's title names the show asked for. A text search for "Monster The Ed Gein Story S01E01" also finds
 * other shows' S01E01, so the words have to agree; one extra word after the title is allowed when it's a year or a
 * country ("Doctor Who 2005", "The Office US"). An empty title on either side can't be checked and passes. */
export function sameShow(releaseTitle: string, showTitle: string): boolean {
  const wanted = titleWords(showTitle);
  const found = titleWords(withoutSitePrefix(releaseTitle));
  if (!wanted.length || !found.length) return true;
  if (found.join("") === wanted.join("")) return true;
  if (found.length !== wanted.length + 1 || wanted.some((w, i) => found[i] !== w)) return false;
  const extra = found[found.length - 1];
  const isYear = /^\d{4}$/.test(extra) && Number(extra) >= 1900 && Number(extra) <= 2100;
  return isYear || /^\p{L}{2}$/u.test(extra);
}
