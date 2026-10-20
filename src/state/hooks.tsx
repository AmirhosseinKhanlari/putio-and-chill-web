import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { tmdb, type CatalogItem, type MediaKind } from "../api/tmdb";
import { library, type LibraryEntry } from "../lib/library";
import { libraryScope } from "../lib/libraryScope";
import { positionSync } from "../lib/positionSync";
import { loadSettings, useSettings } from "../lib/settings";
import { keys, readJSON, writeJSON } from "../lib/storage";
import { mergeOldFoldersOnce } from "./oldFolderMerge";
import { useSession } from "./session";

/** The library, re-rendering when it changes. With automatic updates on (Settings → Library), it's read again from
 * put.io when older than the chosen interval, checked once a minute while the app is open; with them off, only
 * when it has never been read, when what it reads changed (libraryScope.ts), or on Update Now. */
export function useLibrary() {
  useSyncExternalStore(library.subscribe, library.getVersion);
  const { putio } = useSession();
  const { libraryAutoUpdate, libraryUpdateMinutes, moviesFolder, tvFolder } = useSettings();
  useEffect(() => {
    if (!putio) return;
    const check = () => {
      const due = libraryAutoUpdate && library.isStale(libraryUpdateMinutes * 60_000);
      if (due || library.updatedAt === 0 || library.needsRescan(libraryScope(loadSettings()))) void refreshLibrary(putio);
    };
    check();
    return everyMinute(check);
  }, [putio, libraryAutoUpdate, libraryUpdateMinutes, moviesFolder, tvFolder]);
  return library;
}

/** One shared minute timer for every mounted useLibrary (many screens use it at once); runs the latest check. */
const minuteChecks = new Set<() => void>();
let minuteTimer: ReturnType<typeof setInterval> | undefined;
function everyMinute(check: () => void) {
  minuteChecks.add(check);
  minuteTimer ??= setInterval(() => { [...minuteChecks].at(-1)?.(); }, 60_000);
  return () => {
    minuteChecks.delete(check);
    if (!minuteChecks.size && minuteTimer) { clearInterval(minuteTimer); minuteTimer = undefined; }
  };
}

/** How the library looks files up on TMDB (also Fix Match's Match Automatically). */
export const catalogSearch = (kind: MediaKind, title: string, year?: number) => tmdb.searchKind(kind, title, year);
export const catalogSeasonCount = (tmdbID: number) => tmdb.seasonCount(tmdbID);

/** `afterChanges`: put.io just changed, so a refresh already running (which may have read the old state) doesn't count. */
export function refreshLibrary(putio: NonNullable<ReturnType<typeof useSession>["putio"]>, afterChanges = false) {
  return library.refresh(putio, catalogSearch, libraryScope(loadSettings()), { afterChanges, seasonCount: catalogSeasonCount });
}

/** Positions saved on other devices, read without reading all of put.io: when the app opens, when it comes back
 * to the front (`onFocus`), and when Home opens. Saves that didn't reach put.io are sent first. At most every 30 s. */
export function usePositionChecks({ onFocus = false } = {}) {
  const { putio } = useSession();
  useEffect(() => {
    if (!putio) return;
    const check = () => { if (document.visibilityState !== "hidden") void positionSync.check(putio); };
    check();
    if (!onFocus) return;
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [putio, onFocus]);
}

/** The first time the app opens signed in: merges the old AMDB/Movies and AMDB/TV folders into Movies and TV Series
 * (once per account), reads the library again and says what moved. */
export function useOldFolderMerge() {
  const { putio } = useSession();
  const toast = useToast();
  useEffect(() => {
    if (!putio) return;
    void mergeOldFoldersOnce(putio, () => refreshLibrary(putio, true)).then((result) => {
      if (result?.message) toast(result.message);
    });
  }, [putio, toast]);
}

export function useAccount() {
  const { putio } = useSession();
  return useQuery({
    queryKey: ["account"],
    queryFn: () => putio!.account(),
    enabled: Boolean(putio),
    staleTime: 30_000,
  });
}

/** A library file as a title (movie or show) to open. */
export function entryItem(entry: LibraryEntry): CatalogItem | undefined {
  const m = entry.match;
  return m ? { tmdbID: m.tmdbID, kind: m.kind, title: m.title, year: m.year, posterPath: m.posterPath, backdropPath: m.backdropPath } : undefined;
}

// MARK: My List

const MyListContext = createContext<{ items: CatalogItem[]; has: (i: CatalogItem) => boolean; toggle: (i: CatalogItem) => void } | null>(null);

export function MyListProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CatalogItem[]>(() => readJSON(keys.myList, []));
  const has = useCallback((i: CatalogItem) => items.some((x) => x.tmdbID === i.tmdbID && x.kind === i.kind), [items]);
  const toggle = useCallback((i: CatalogItem) => {
    setItems((current) => {
      const exists = current.some((x) => x.tmdbID === i.tmdbID && x.kind === i.kind);
      const next = exists ? current.filter((x) => !(x.tmdbID === i.tmdbID && x.kind === i.kind)) : [i, ...current];
      writeJSON(keys.myList, next);
      return next;
    });
  }, []);
  return <MyListContext.Provider value={{ items, has, toggle }}>{children}</MyListContext.Provider>;
}

export function useMyList() {
  const value = useContext(MyListContext);
  if (!value) throw new Error("useMyList outside MyListProvider");
  return value;
}

// MARK: Toasts

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    // Longer messages (the folder merge) stay up long enough to read.
    const timer = setTimeout(() => setMessage(null), Math.max(4000, message.length * 55));
    return () => clearTimeout(timer);
  }, [message]);
  return (
    <ToastContext.Provider value={setMessage}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">{message && <div className="toast">{message}</div>}</div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
