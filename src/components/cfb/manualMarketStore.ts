"use client";

/**
 * The only DOM-touching piece of CFB's manual-market layer — thin
 * `localStorage` glue around the pure functions in `@/lib/cfb/manualMarket`.
 * Mirrors `src/lib/slip/SlipContext.tsx`'s module-level store +
 * `useSyncExternalStore` pattern (correct under React's SSR/hydration rules,
 * gets cross-tab sync for free via the "storage" event), but keeps
 * serialize/validate/diff logic out of this file entirely so that logic stays
 * testable without a real browser — see `manualMarket.test.ts`.
 */
import { useSyncExternalStore } from "react";
import {
  serializeStore,
  parseStore,
  getEntry,
  setEntry,
  clearEntry,
  storageKey,
  type ManualMarketStore,
} from "@/lib/cfb/manualMarket";
import type { ManualMarketEntry } from "@/lib/cfb/types";

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedStore: ManualMarketStore = {};

function readStore(): ManualMarketStore {
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

function writeStore(store: ManualMarketStore) {
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

const EMPTY_STORE: ManualMarketStore = {};
function getServerSnapshot(): ManualMarketStore {
  return EMPTY_STORE;
}

/** One game's manual market entry, plus setters scoped to that game's ESPN event id. Reset-able independently of the rest of the slate. */
export function useManualMarketEntry(espnEventId: string): {
  entry: ManualMarketEntry;
  setEntry: (entry: ManualMarketEntry) => void;
  clear: () => void;
} {
  const store = useSyncExternalStore(subscribe, readStore, getServerSnapshot);
  return {
    entry: getEntry(store, espnEventId),
    setEntry: (entry) => writeStore(setEntry(readStore(), espnEventId, entry)),
    clear: () => writeStore(clearEntry(readStore(), espnEventId)),
  };
}
