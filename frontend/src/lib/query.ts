// Tiny "useQuery" cache (zero-dep, KISS) ported from oliver-och-klara-i-japan: data is
// persisted to localStorage so it's there instantly on next launch, and revalidated in
// the background. A global counter drives the subtle spinner / pull-to-refresh.
import { useEffect, useSyncExternalStore } from 'react';
import { api, type CodedError } from './api.ts';

type QueryData = unknown;

const LS = 'q:';
const cache = new Map<string, QueryData>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<QueryData>>();

let fetching = 0;
const fetchSubs = new Set<() => void>();
const emitFetch = (): void => fetchSubs.forEach((l) => l());

function read(key: string): QueryData {
  if (cache.has(key)) return cache.get(key);
  try {
    const s = localStorage.getItem(LS + key);
    if (s != null) {
      const d = JSON.parse(s);
      cache.set(key, d);
      return d;
    }
  } catch {
    /* storage off/broken — ignore */
  }
  return undefined;
}

function write(key: string, data: QueryData): void {
  cache.set(key, data);
  try {
    localStorage.setItem(LS + key, JSON.stringify(data));
  } catch {
    /* full/blocked */
  }
  (listeners.get(key) || []).forEach((l) => l());
}
export const setQueryData = write;
export const getQueryData = read;

function subscribe(key: string, fn: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => set!.delete(fn);
}

// Background revalidation. Dedupes per key; bumps the global spinner.
export function refetch(key: string): Promise<QueryData> {
  if (inflight.has(key)) return inflight.get(key)!;
  fetching++;
  emitFetch();
  const p = api
    .get(key)
    .then((d) => {
      write(key, d);
      return d;
    })
    .catch((e: CodedError) => {
      if (e.code !== 401) throw e;
    })
    .finally(() => {
      inflight.delete(key);
      fetching--;
      emitFetch();
    });
  inflight.set(key, p);
  return p;
}

export function refetchAll(): Promise<unknown[]> {
  return Promise.all([...cache.keys()].map((k) => refetch(k).catch(() => {})));
}

// Returns cached data immediately (undefined if never loaded) and triggers a background
// revalidation on mount.
export function useQuery<T = unknown>(key: string): T | undefined {
  const data = useSyncExternalStore(
    (fn) => subscribe(key, fn),
    () => read(key),
  );
  useEffect(() => {
    if (key) refetch(key);
  }, [key]);
  return data as T | undefined;
}

export function useIsFetching(): boolean {
  return (
    useSyncExternalStore(
      (fn) => {
        fetchSubs.add(fn);
        return () => fetchSubs.delete(fn);
      },
      () => fetching,
    ) > 0
  );
}

export function clearCache(): void {
  for (const k of cache.keys()) {
    try {
      localStorage.removeItem(LS + k);
    } catch {
      /* */
    }
  }
  cache.clear();
  listeners.forEach((set) => set.forEach((l) => l()));
}
