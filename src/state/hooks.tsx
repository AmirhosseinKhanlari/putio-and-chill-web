import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { tmdb, type CatalogItem } from "../api/tmdb";
import { library, type LibraryEntry } from "../lib/library";
import { keys, readJSON, writeJSON } from "../lib/storage";
import { useSession } from "./session";

/** The library, re-rendering when it changes; refreshed from put.io when older than 15 minutes. */
export function useLibrary() {
  useSyncExternalStore(library.subscribe, library.getVersion);
  const { putio } = useSession();
  useEffect(() => {
    if (putio && library.isStale()) void refreshLibrary(putio);
  }, [putio]);
  return library;
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
