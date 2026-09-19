/**
 * CFB v0's manual market-line layer — there's no active odds provider wired
 * for CFB (no paid API dependency, per the task), so the owner types in a
 * book's numbers by hand for research comparison. Every function here is
 * pure and framework-agnostic (no `localStorage`, no DOM) precisely so the
 * serialization/validation logic is unit-testable without a real browser;
 * the actual `localStorage` I/O lives in the client component that calls
 * these (src/components/cfb/CfbGameCard.tsx), mirroring how
 * src/lib/slip/SlipContext.tsx keeps its store thin.
 *
 * Never computes a staking unit or a Kelly size — model-vs-market
 * differences here are research context, not a guaranteed-EV claim.
 */
import { devigPair } from "@/lib/odds/devig";
import { spreadCoverProbability, totalOverProbability } from "./model";
import type { CfbGamePrediction, ManualMarketComparison, ManualMarketEntry } from "./types";
import { EMPTY_MANUAL_MARKET_ENTRY } from "./types";

/** Valid American odds: an integer at or beyond ±100 — there's no valid American value strictly between them. */
export function validateAmericanOdds(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n > -100 && n < 100) return null;
  return n;
}

/** A point spread: any finite number within a sane blowout bound (a 100-point CFB spread would be a data-entry typo, not a real line). */
export function validateSpread(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || Math.abs(n) > 100) return null;
  return n;
}

/** A game total: a finite, positive number within a sane bound. */
export function validateTotal(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 200) return null;
  return n;
}

/** Per-game manual entries, keyed by ESPN event id so a clear/reset can target one game without disturbing the rest of the slate. */
export type ManualMarketStore = Record<string, ManualMarketEntry>;

const STORAGE_KEY = "archer-cfb-market-v1";

export function storageKey(): string {
  return STORAGE_KEY;
}

/** Re-validates every field on the way out, so a hand-edited or corrupted localStorage value can never surface an invalid line to the UI. */
function sanitizeEntry(raw: unknown): ManualMarketEntry {
  const r = (raw ?? {}) as Partial<Record<keyof ManualMarketEntry, unknown>>;
  return {
    homeSpread: validateSpread(r.homeSpread),
    marketTotal: validateTotal(r.marketTotal),
    homeMoneyline: validateAmericanOdds(r.homeMoneyline),
    awayMoneyline: validateAmericanOdds(r.awayMoneyline),
  };
}

/** JSON-serializes the store for `localStorage.setItem`. */
export function serializeStore(store: ManualMarketStore): string {
  return JSON.stringify(store);
}

/** Parses a raw `localStorage.getItem` value back into a store. Tolerant of `null`, corrupt JSON, or a shape that no longer matches — falls back to empty rather than throwing, and sanitizes every entry it does recover. */
export function parseStore(raw: string | null): ManualMarketStore {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};

  const out: ManualMarketStore = {};
  for (const [eventId, entry] of Object.entries(parsed as Record<string, unknown>)) {
    out[eventId] = sanitizeEntry(entry);
  }
  return out;
}

export function getEntry(store: ManualMarketStore, espnEventId: string): ManualMarketEntry {
  return store[espnEventId] ?? EMPTY_MANUAL_MARKET_ENTRY;
}

export function setEntry(store: ManualMarketStore, espnEventId: string, entry: ManualMarketEntry): ManualMarketStore {
  return { ...store, [espnEventId]: sanitizeEntry(entry) };
}

export function clearEntry(store: ManualMarketStore, espnEventId: string): ManualMarketStore {
  return Object.fromEntries(Object.entries(store).filter(([id]) => id !== espnEventId));
}

/**
 * Model-vs-market research comparison. `spreadDiff` is in points, home
 * perspective: positive means the model likes the home side more than the
 * market's spread does (the market's implied home margin is `-homeSpread`,
 * following standard American-odds spread convention — a "-3.5" home line
 * means the market expects home to win by 3.5).
 *
 * De-vigs the two moneylines with the shared `devigPair` (proportional
 * devig, the same method the odds pool uses elsewhere) only when both sides
 * are entered — a one-sided moneyline can't be de-vigged. Never produces a
 * staking unit.
 */
export function compareToModel(entry: ManualMarketEntry, prediction: CfbGamePrediction): ManualMarketComparison {
  const spreadDiff = entry.homeSpread === null ? null : prediction.projectedMargin - -entry.homeSpread;
  const totalDiff = entry.marketTotal === null ? null : prediction.projectedTotal - entry.marketTotal;

  let marketHomeWinProb: number | null = null;
  let marketAwayWinProb: number | null = null;
  let winProbDiff: number | null = null;
  if (entry.homeMoneyline !== null && entry.awayMoneyline !== null) {
    const { fairA, fairB } = devigPair(entry.homeMoneyline, entry.awayMoneyline);
    marketHomeWinProb = fairA;
    marketAwayWinProb = fairB;
    winProbDiff = prediction.homeWinProb - fairA;
  }

  let homeCoverProb: number | null = null;
  let awayCoverProb: number | null = null;
  if (entry.homeSpread !== null) {
    const cover = spreadCoverProbability(prediction.projectedMargin, entry.homeSpread);
    homeCoverProb = cover.homeCoverProb;
    awayCoverProb = cover.awayCoverProb;
  }

  let overProb: number | null = null;
  let underProb: number | null = null;
  if (entry.marketTotal !== null) {
    const total = totalOverProbability(prediction.projectedTotal, entry.marketTotal);
    overProb = total.overProb;
    underProb = total.underProb;
  }

  return {
    spreadDiff,
    totalDiff,
    marketHomeWinProb,
    marketAwayWinProb,
    winProbDiff,
    homeCoverProb,
    awayCoverProb,
    overProb,
    underProb,
  };
}
