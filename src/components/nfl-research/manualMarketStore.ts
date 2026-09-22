"use client";

/**
 * The only DOM-touching piece of NFL research's manual-market layer — thin
 * `localStorage` glue around `@/lib/nfl/research/manualMarket`'s pure
 * functions. Mirrors `src/components/cfb/manualMarketStore.ts` exactly (see
 * that file's docstring for the `useSyncExternalStore` rationale).
 */
import { useSyncExternalStore } from "react";
import {
  serializeStore,
  parseStore,
  getEntry,
  setEntry,
  clearEntry,
  storageKey,
  type NflManualMarketStore,
  type NflManualMarketEntry,
} from "@/lib/nfl/research/manualMarket";

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedStore: NflManualMarketStore = {};

function readStore(): NflManualMarketStore {
  if (typeof window === "undefined") return {};
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey());
  } catch {
    return {};
  }
  if (raw === cachedRaw) return cachedStore; // stable reference required by useSyncExternalStore
  cachedRaw = raw;
  cachedStore = parseStore(raw);
  return cachedStore;
}

function writeStore(store: NflManualMarketStore) {
  cachedStore = store;
  cachedRaw = serializeStore(store);
  try {
    localStorage.setItem(storageKey(), cachedRaw);
  } catch {
    // Storage unavailable/full — the page still works for this session, just won't persist.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

const EMPTY_STORE: NflManualMarketStore = {};
function getServerSnapshot(): NflManualMarketStore {
  return EMPTY_STORE;
}

export function useNflManualMarketEntry(espnEventId: string): {
  entry: NflManualMarketEntry;
  setEntry: (entry: Omit<NflManualMarketEntry, "enteredAt">) => void;
  clear: () => void;
} {
  const store = useSyncExternalStore(subscribe, readStore, getServerSnapshot);
  return {
    entry: getEntry(store, espnEventId),
    setEntry: (entry) => writeStore(setEntry(readStore(), espnEventId, entry)),
    clear: () => writeStore(clearEntry(readStore(), espnEventId)),
  };
}
