/** The app's settings (the iPhone app's AppSettings, minus what only a device can do), saved in this browser.
 * Read them with useSettings(); outside React, loadSettings(). */
import { useSyncExternalStore } from "react";
import { keys, readJSON, writeJSON } from "./storage";

export interface SourceConfig {
  id: "chill" | "yts" | "eztv" | "apibay" | "knaben" | "torrentscsv";
  name: string;
  enabled: boolean;
}

export interface SmartGetRule {
  /** 4320, 2160, 1080, 720, 480; null = the best there is. */
  resolution: number | null;
  /** Largest release Get & Watch picks, in GB; null = no limit. */
  maxSizeGB: number | null;
}

export interface SubtitleStyle {
  size: "small" | "medium" | "large" | "extraLarge";
  background: "none" | "translucent" | "solid";
  color: "white" | "yellow" | "cyan" | "green";
  typeface: "standard" | "rounded" | "serif" | "monospaced";
}

export interface PutioFolderRef {
  id: number;
  path: string;
}

export interface AppSettings {
  sources: SourceConfig[];
  /** Preselected in Versions; null = all. */
  defaultResolution: number | null;
  /** "Get & Watch" sends the best release straight away instead of opening Versions. */
  oneTapGet: boolean;
  smartGet: SmartGetRule;
  /** Next episode plays by itself at the end. */
  autoPlayNextEpisode: boolean;
  /** A Get & Watch that finishes while its title is open counts down and plays. */
  autoPlayCountdown: boolean;
  /** ISO 639-1 codes; null subtitles = off, null audio = the original track. */
  subtitleLanguage: string | null;
  audioLanguage: string | null;
  subtitleStyle: SubtitleStyle;
  /** For OpenSubtitles results in the player (opensubtitles.com → API consumers). */
  openSubtitlesKey: string | null;
  libraryAutoUpdate: boolean;
  libraryUpdateMinutes: number;
  /** Where Get & Watch saves in put.io; null = AMDB/Movies and AMDB/TV. */
  moviesFolder: PutioFolderRef | null;
  tvFolder: PutioFolderRef | null;
  /** Episodes go into "Season N" folders inside the show's folder. */
  seasonFolders: boolean;
  /** Delete movies finished this many days ago; null = off. */
  autoCleanDays: number | null;
  /** IMDb watchlist link, shown on Home. */
  imdbWatchlist: string | null;
}

export const defaultSources: SourceConfig[] = [
  { id: "chill", name: "chill.institute", enabled: true },
  { id: "yts", name: "YTS", enabled: true },
  { id: "eztv", name: "EZTV", enabled: true },
  { id: "apibay", name: "The Pirate Bay (apibay)", enabled: true },
  { id: "knaben", name: "Knaben", enabled: true },
  { id: "torrentscsv", name: "Torrents.csv", enabled: true },
];

export const defaultSettings: AppSettings = {
  sources: defaultSources,
  defaultResolution: null,
  oneTapGet: true,
  smartGet: { resolution: 1080, maxSizeGB: 10 },
  autoPlayNextEpisode: true,
  autoPlayCountdown: true,
  subtitleLanguage: null,
  audioLanguage: null,
  subtitleStyle: { size: "medium", background: "translucent", color: "white", typeface: "standard" },
  openSubtitlesKey: null,
  libraryAutoUpdate: true,
  libraryUpdateMinutes: 60,
  moviesFolder: null,
  tvFolder: null,
  seasonFolders: true,
  autoCleanDays: null,
  imdbWatchlist: null,
};

/** Saved settings with defaults for anything newer (and every known source, in order). */
function load(): AppSettings {
  const saved = readJSON<Partial<AppSettings> & { resolution?: number }>(keys.settings, {});
  const merged: AppSettings = { ...defaultSettings, ...saved, subtitleStyle: { ...defaultSettings.subtitleStyle, ...saved.subtitleStyle } };
  // The first web build kept only { resolution }.
  if (saved.resolution && !saved.smartGet) merged.smartGet = { ...defaultSettings.smartGet, resolution: saved.resolution };
  merged.sources = defaultSources.map((d) => ({ ...d, enabled: saved.sources?.find((s) => s.id === d.id)?.enabled ?? d.enabled }));
  return merged;
}

let current = load();
const listeners = new Set<() => void>();

export const loadSettings = (): AppSettings => current;

export function updateSettings(change: Partial<AppSettings> | ((s: AppSettings) => AppSettings)) {
  current = typeof change === "function" ? change(current) : { ...current, ...change };
  writeJSON(keys.settings, current);
  listeners.forEach((l) => l());
}

export function useSettings(): AppSettings {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => current);
}

export const isSourceEnabled = (s: AppSettings, id: SourceConfig["id"]) => s.sources.some((x) => x.id === id && x.enabled);
