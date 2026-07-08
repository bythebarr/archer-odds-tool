"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { MarketType } from "@/generated/prisma/client";

export type SlipSport = "mlb" | "tennis" | "soccer";

export interface SlipPick {
  id: string;
  sport: SlipSport;
  matchId: string;
  /** e.g. "NYY @ BOS" or "Alcaraz vs. Sinner" */
  matchLabel: string;
  /** e.g. "Yankees ML", "Over 8.5", "Alcaraz" */
  selectionLabel: string;
  marketType: MarketType;
  point: number | null;
  bookKey: string;
  bookName: string;
  priceAmerican: number;
  addedAt: number;
}

/** Stable identity for a pick — same shape a book/side/point/market combination always resolves to, so re-adding the identical row is a no-op and the UI can tell "already in slip" without a lookup table elsewhere. */
export function buildSlipPickId(params: {
  sport: SlipSport;
  matchId: string;
  marketType: MarketType;
  side: string;
  point: number | null;
  bookKey: string;
}): string {
  return [params.sport, params.matchId, params.marketType, params.side, params.point, params.bookKey].join("|");
}

const STORAGE_KEY = "archer-slip-v1";

/**
 * Module-level store (not React state) read via useSyncExternalStore — the
 * correct pattern for subscribing to a browser API like localStorage
 * without a setState-in-effect (React's hydration/SSR rules flag that
 * pattern). Also gets cross-tab sync for free via the "storage" event.
 */
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedPicks: SlipPick[] = [];

function readPicks(): SlipPick[] {
  if (typeof window === "undefined") return [];
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === cachedRaw) return cachedPicks; // stable reference when nothing changed, required by useSyncExternalStore
  cachedRaw = raw;
  try {
    cachedPicks = raw ? JSON.parse(raw) : [];
  } catch {
    cachedPicks = []; // corrupt storage — start empty rather than crash
  }
  return cachedPicks;
}

function writePicks(picks: SlipPick[]) {
  cachedPicks = picks;
  cachedRaw = JSON.stringify(picks);
  try {
    localStorage.setItem(STORAGE_KEY, cachedRaw);
  } catch {
    // Storage unavailable/full — the slip still works for this session, just won't persist.
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

// Stable reference — useSyncExternalStore requires getServerSnapshot to return
// the same value across calls (a fresh [] each time triggers React's
// "getServerSnapshot should be cached to avoid an infinite loop" warning).
const EMPTY_PICKS: SlipPick[] = [];
function getServerSnapshot(): SlipPick[] {
  return EMPTY_PICKS;
}

interface SlipContextValue {
  picks: SlipPick[];
  addPick: (pick: SlipPick) => void;
  removePick: (id: string) => void;
  clearSlip: () => void;
  isInSlip: (id: string) => boolean;
}

const SlipContext = createContext<SlipContextValue | null>(null);

/**
 * Client-side-only picks slip — no accounts/auth system exists yet (see
 * mobile_app_roadmap notes), so this is deliberately browser-local
 * (localStorage), not server-persisted per-user data. Research/tracking
 * only: adding a pick here does not place a bet anywhere (see the site
 * footer's disclaimer) — actual sportsbook deep-linking is an explicitly
 * deferred future direction, not built here.
 */
export function SlipProvider({ children }: { children: ReactNode }) {
  const picks = useSyncExternalStore(subscribe, readPicks, getServerSnapshot);

  function addPick(pick: SlipPick) {
    const current = readPicks();
    if (current.some((p) => p.id === pick.id)) return;
    writePicks([...current, pick]);
  }
  function removePick(id: string) {
    writePicks(readPicks().filter((p) => p.id !== id));
  }
  function clearSlip() {
    writePicks([]);
  }
  function isInSlip(id: string) {
    return picks.some((p) => p.id === id);
  }

  return (
    <SlipContext.Provider value={{ picks, addPick, removePick, clearSlip, isInSlip }}>
      {children}
    </SlipContext.Provider>
  );
}

export function useSlip(): SlipContextValue {
  const ctx = useContext(SlipContext);
  if (!ctx) throw new Error("useSlip must be used within SlipProvider");
  return ctx;
}
