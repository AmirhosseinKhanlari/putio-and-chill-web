/** Magnet links and info-hashes (port of the iPhone app's Magnet). Sources that only give a hash get a magnet link
 * with the same public trackers the iPhone app adds. */
export const defaultTrackers = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
];

/** The info-hash inside a magnet link, normalized. */
export function infoHashFromMagnet(link: string): string | undefined {
  if (!link.toLowerCase().startsWith("magnet:")) return undefined;
  const m = /xt=urn:btih:([a-z0-9]+)/i.exec(link);
  return m ? normalizeHash(m[1]) : undefined;
}

/** A lowercase 40-character hex info-hash from hex or base32 input; undefined for anything else. */
export function normalizeHash(hash: string | null | undefined): string | undefined {
  const trimmed = (hash ?? "").trim();
  if (/^[0-9a-f]{40}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.length === 32) return base32ToHex(trimmed.toUpperCase());
  return undefined;
}

/** Like URLSearchParams (spaces as "+"), as the iPhone app writes them. */
const formEncode = (s: string) => new URLSearchParams({ x: s }).toString().slice(2);

export function makeMagnet(infoHash: string, name: string, trackers = defaultTrackers): string {
  return `magnet:?xt=urn:btih:${infoHash}&dn=${formEncode(name)}${trackers.map((t) => `&tr=${formEncode(t)}`).join("")}`;
}

function base32ToHex(input: string): string | undefined {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0, bits = 0;
  const out: number[] = [];
  for (const char of input) {
    const index = alphabet.indexOf(char);
    if (index < 0) return undefined;
    buffer = ((buffer << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out.length === 20 ? out.map((b) => b.toString(16).padStart(2, "0")).join("") : undefined;
}
