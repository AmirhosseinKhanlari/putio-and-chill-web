/** mymoviz.co "latest movies" / "latest TV shows" (no account needed): server-rendered HTML, newest first. Each card
 * carries the English title with its year and the IMDb id in its poster's file name. MyMoviz doesn't allow browser
 * requests, so this goes through the app's proxy. */
import type { MediaKind } from "../tmdb";
import { decodeEntities, splitYear, type ListTitle } from "./titles";

const PROXY = "/proxy/mymoviz";
const paths: Record<MediaKind, string> = { movie: "main/latest-movies", tv: "tvshows/tv-latest" };

export function parseMyMoviz(html: string, kind: MediaKind): ListTitle[] {
  const card = /<a class="mv-card"[^>]*\btitle="([^"]+)"/g;
  const found = [...html.matchAll(card)];
  return found.flatMap((match, index) => {
    const label = decodeEntities(match[1]).trim();
    // The IMDb id sits in this card's poster URL, before the next card starts.
    const start = match.index ?? 0;
    const end = found[index + 1]?.index ?? html.length;
    const body = html.slice(start, Math.min(end, start + 1500));
    const imdbID = /tt\d{6,}/.exec(body)?.[0];
    const [name, year] = splitYear(label);
    return name ? [{ kind, title: name, year, imdbID, source: "MYMOVIZ" }] : [];
  });
}

/** The newest 24 (the first page; that's all the app shows from here). */
export async function myMovizLatest(kind: MediaKind): Promise<ListTitle[]> {
  const response = await fetch(`${PROXY}/${paths[kind]}`, { headers: { Accept: "text/html", "Accept-Language": "en" } });
  if (!response.ok) throw new Error(`MyMoviz ${response.status}`);
  return parseMyMoviz(await response.text(), kind).slice(0, 24);
}
