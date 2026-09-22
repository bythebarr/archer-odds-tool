/**
 * NFL research's manual market-line layer — mirrors `src/lib/cfb/manualMarket.ts`'s
 * shape and reasoning closely (see that file's docstring), with one
 * deliberate difference: this module NEVER computes a spread-cover or
 * over/under probability, because requirement 4 of the task that produced
 * this file explicitly forbids fabricating either for NFL research. What it
 * DOES compute is a plain point/probability DIFFERENCE against the model —
 * transparent disagreement, never a probability against a line.
 *
 * Every function here is pure and framework-agnostic (no `localStorage`, no
 * DOM); the actual I/O lives in the client component that calls these
 * (`src/components/nfl-research/NflResearchGameCard.tsx`).
 *
 * These entries are NEVER treated as an authoritative closing line or as CLV
 * evidence — see this module's own `NflManualMarketEntry.lineType`, which is
 * a plain, user-supplied label, not a system-verified designation, and see
 * `src/lib/nfl/research/captureSnapshot.ts`'s explicit refusal to read from
 * this store when writing a `PredictionRun`.
 */
import { devigPair } from "@/lib/odds/devig";
import type { NflGamePrediction } from "./predictionCapture";

/** Valid American odds: an integer at or beyond ±100 — mirrors CFB's identical validator. */
export function validateAmericanOdds(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n > -100 && n < 100) return null;
  return n;
}

/** A point spread: any finite number within a sane bound. `null`/`undefined`/`""` stay `null` — see CFB's identical validator for why an absent line must never become a fabricated pick'em 0. */
export function validateSpread(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || Math.abs(n) > 60) return null; // an NFL blowout spread tops out far below CFB's bound
  return n;
}

export type NflManualLineType = "current" | "closing";

export interface NflManualMarketEntry {
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  homeSpread: number | null;
  awaySpread: number | null;
  /** A plain, user-supplied label — never system-verified, never treated as evidence this genuinely was the closing number. */
  lineType: NflManualLineType | null;
  /** Free-text bookmaker/source label, e.g. "DraftKings". */
  source: string | null;
  /** ISO timestamp, set automatically at entry time — never user-editable (see the component that calls `setEntry`). */
  enteredAt: string | null;
}

export const EMPTY_NFL_MANUAL_MARKET_ENTRY: NflManualMarketEntry = {
  homeMoneyline: null,
  awayMoneyline: null,
  homeSpread: null,
  awaySpread: null,
  lineType: null,
  source: null,
  enteredAt: null,
};

function validateLineType(raw: unknown): NflManualLineType | null {
  return raw === "current" || raw === "closing" ? raw : null;
}

function validateSource(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, 60); // a sane display bound, not a real constraint on book names
  return trimmed === "" ? null : trimmed;
}

function validateTimestamp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = new Date(raw);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

export type NflManualMarketStore = Record<string, NflManualMarketEntry>;

const STORAGE_KEY = "archer-nfl-research-market-v1";
export function storageKey(): string {
  return STORAGE_KEY;
}

/** Re-validates every field on the way out, so a hand-edited or corrupted localStorage value can never surface an invalid line to the UI. */
function sanitizeEntry(raw: unknown): NflManualMarketEntry {
  const r = (raw ?? {}) as Partial<Record<keyof NflManualMarketEntry, unknown>>;
  return {
    homeMoneyline: validateAmericanOdds(r.homeMoneyline),
    awayMoneyline: validateAmericanOdds(r.awayMoneyline),
    homeSpread: validateSpread(r.homeSpread),
    awaySpread: validateSpread(r.awaySpread),
    lineType: validateLineType(r.lineType),
    source: validateSource(r.source),
    enteredAt: validateTimestamp(r.enteredAt),
  };
}

export function serializeStore(store: NflManualMarketStore): string {
  return JSON.stringify(store);
}

/** Tolerant of `null`, corrupt JSON, or a shape that no longer matches — falls back to empty rather than throwing, and sanitizes every recovered entry. */
export function parseStore(raw: string | null): NflManualMarketStore {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};

  const out: NflManualMarketStore = {};
  for (const [eventId, entry] of Object.entries(parsed as Record<string, unknown>)) {
    out[eventId] = sanitizeEntry(entry);
  }
  return out;
}

export function getEntry(store: NflManualMarketStore, espnEventId: string): NflManualMarketEntry {
  return store[espnEventId] ?? EMPTY_NFL_MANUAL_MARKET_ENTRY;
}

/** Always stamps `enteredAt` to the current instant — the caller never supplies it directly, so a stale or fabricated timestamp can't be entered. */
export function setEntry(
  store: NflManualMarketStore,
  espnEventId: string,
  entry: Omit<NflManualMarketEntry, "enteredAt">,
  now: Date = new Date()
): NflManualMarketStore {
  return { ...store, [espnEventId]: sanitizeEntry({ ...entry, enteredAt: now.toISOString() }) };
}

export function clearEntry(store: NflManualMarketStore, espnEventId: string): NflManualMarketStore {
  return Object.fromEntries(Object.entries(store).filter(([id]) => id !== espnEventId));
}

/**
 * Transparent model-vs-market DISAGREEMENT only — never a probability
 * against a line. `marginDiff` is a point difference (model's expected home
 * margin minus the market-implied home margin, `-homeSpread`), and
 * `winProbDiff` is a probability difference against the de-vigged moneyline
 * consensus (`devigPair`, the same shared helper CFB/the odds pool use) —
 * neither is a cover or over/under probability, and this function has no
 * such function to call even if it wanted to (unlike CFB's `manualMarket.ts`,
 * which imports `spreadCoverProbability`/`totalOverProbability` — this file
 * deliberately does not).
 */
export interface NflManualMarketComparison {
  /** Model's expected home margin minus the market-implied home margin (`-homeSpread`). Positive = model likes home more than the market's spread does. */
  marginDiff: number | null;
  /** De-vigged market home win probability, only when both moneylines are entered. */
  marketHomeWinProb: number | null;
  marketAwayWinProb: number | null;
  /** Model's homeWinProb minus the de-vigged market's. */
  winProbDiff: number | null;
}

export function compareToModel(entry: NflManualMarketEntry, prediction: NflGamePrediction): NflManualMarketComparison {
  const marginDiff = entry.homeSpread === null ? null : prediction.expectedHomeMargin - -entry.homeSpread;

  let marketHomeWinProb: number | null = null;
  let marketAwayWinProb: number | null = null;
  let winProbDiff: number | null = null;
  if (entry.homeMoneyline !== null && entry.awayMoneyline !== null) {
    const { fairA, fairB } = devigPair(entry.homeMoneyline, entry.awayMoneyline);
    marketHomeWinProb = fairA;
    marketAwayWinProb = fairB;
    winProbDiff = prediction.homeWinProb - fairA;
  }

  return { marginDiff, marketHomeWinProb, marketAwayWinProb, winProbDiff };
}
