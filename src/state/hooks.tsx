import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { tmdb, type CatalogItem } from "../api/tmdb";
import { library, type LibraryEntry } from "../lib/library";
import { useSettings } from "../lib/settings";
import { keys, readJSON, writeJSON } from "../lib/storage";
import { useSession } from "./session";

/** The library, re-rendering when it changes. With automatic updates on (Settings → Library), it's read again from
 * put.io when older than the chosen interval, checked once a minute while the app is open; with them off, only
 * when it has never been read or on Update Now. */
export function useLibrary() {
  useSyncExternalStore(library.subscribe, library.getVersion);
  const { putio } = useSession();
  const { libraryAutoUpdate, libraryUpdateMinutes } = useSettings();
  useEffect(() => {
    if (!putio) return;
    const check = () => {
      const due = libraryAutoUpdate && library.isStale(libraryUpdateMinutes * 60_000);
      if (due || library.updatedAt === 0) void refreshLibrary(putio);
    };
    check();
    return everyMinute(check);
  }, [putio, libraryAutoUpdate, libraryUpdateMinutes]);
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

export function refreshLibrary(putio: NonNullable<ReturnType<typeof useSession>["putio"]>) {
  return library.refresh(putio, (kind, title, year) => tmdb.searchKind(kind, title, year));
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
    const timer = setTimeout(() => setMessage(null), 4000);
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
