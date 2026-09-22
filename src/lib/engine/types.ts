/**
 * The sport-agnostic engine contract. See docs/architecture/sport-engine.md.
 *
 * After the adapter boundary, no code asks "is this MLB?" again — the board,
 * the /track flow, the ledger, the results recap, and the nav all speak `Play`.
 * Each sport implements `SportAdapter`, sealing its own data model, pricing
 * model, and grading rules inside the adapter; the engine only ever sees the
 * normalized types below.
 *
 * Phase 0: types + an empty registry, zero behavior change. Adapters land in
 * later phases (MLB, UFC, ...).
 */
import type { MarketType } from "@/generated/prisma/client";
import type { MarketKind } from "@/lib/queries/oddsPool";
import type { PlayResult } from "@/lib/discord/gradePlay";

/**
 * A sport's display + routing metadata — the single source for nav, the Home
 * launcher, the SportRail, and the /sports lobby. It lives on the adapter
 * (`SportAdapter.meta`), so registering a sport describes it in exactly one
 * place and every sport surface derives from `SPORTS` (see @/lib/sports).
 */
export interface SportMeta {
  /** Registry key of the sport — equals the owning adapter's `key`. */
  sport: string;
  label: string;
  icon: string;
  href: string;
  /** Section/accent color, e.g. "#3b82f6". */
  accent: string;
  /** MLB's board is date-scoped, so its link carries the browsed date; most aren't. */
  carriesDate: boolean;
  /**
   * A sport with a page but no odds/slate presence (F1: results-only). Absent →
   * the sport is on the Slate. Lets the slate/nav split derive from the registry
   * instead of hardcoding "everything but F1".
   */
  resultsOnly?: boolean;
  /**
   * A sport we can PRICE but cannot SETTLE: odds exist, but no provider we use
   * carries its results (tennis — ParlayAPI returns zero scores for ATP and WTA,
   * measured twice; see docs/architecture/provider-coverage.md). Its model still
   * runs and its page still shows signal, but its plays never join the tracked
   * record, because a play that can never be graded would sit "pending" forever
   * and quietly understate the posted count it was measured against.
   *
   * This is a DATA-SOURCE fact, not a product preference: clear it the moment the
   * sport gets a results feed (as MLB has the Stats API, UFC has Cito, F1 has
   * Jolpica), and the sport becomes tracked again with no other change.
   */
  signalOnly?: boolean;
}

/**
 * A grade outcome, plus `pending` — a grader may not be able to settle yet
 * (the event isn't final). Late-settling sports (UFC fight nights) return
 * `pending` and get re-graded by a settle cron. `void` stays excluded from the
 * record, exactly as today.
 */
export type PlayGrade = PlayResult | "pending";

/** The bettable selection, sport-neutral. */
export interface SelectionSpec {
  /** Stored game market, or null for props (which aren't a MarketType). */
  market: MarketType | null;
  /** Compact kind for filtering/labeling: ml | spread | total | prop. */
  kind: MarketKind;
  /** home | away | over | under | draw | red | blue | ... — adapter-defined. */
  side: string;
  point: number | null;
  /** Full pick label, e.g. "Yankees -1.5", "Over 8.5", "Israel Adesanya". */
  label: string;
}

/** Presentation-only extras. NEVER used for pricing, grading, or dedupe. */
export interface PlayDisplay {
  href?: string;
  backed?: "home" | "away" | null;
  playerImageUrl?: string | null;
  playerName?: string | null;
  bestBookInitials?: string;
  booksCount?: number;
  /**
   * The fully-rendered member-facing card line, in the sport's own capper voice
   * (MLB shows edge/units/start; UFC shows opponent/model%/finish lean). The
   * adapter composes it so the board assembles by concatenating lines with zero
   * "is this MLB?" branch — a new sport brings its own line. See @/lib/card/line.
   */
  line?: string;
  /**
   * A dynamic suffix for this sport's board section title (UFC: "<event> · <date>").
   * Omitted → the section falls back to the card's date label (MLB).
   */
  sectionLabel?: string;
}

/** One normalized play — the only currency the engine speaks. */
export interface Play {
  /** Registry key of the producing adapter: "mlb", "ufc", ... */
  sportKey: string;
  /** Stable dedupe key within (postedForDate, sportKey). */
  playKey: string;
  /** Adapter-owned event id (Game.id, UfcBout.id, ...) — opaque to the engine. */
  eventRef: string;
  /** ET YYYY-MM-DD this play settles under (a fight may settle after its tease). */
  postedForDate: string;
  startUtc: Date;
  selection: SelectionSpec;
  /** Best available American price, line-shopped across the allowed books. */
  bestPrice: number;
  bestBookName: string;
  /** MARKET lens: EV vs de-vigged consensus, as a fraction; null for n-way-only markets. */
  marketEv: number | null;
  /** MODEL lens: EV vs the adapter's model probability; null when the sport has no model. */
  modelEv: number | null;
  /** Quarter-Kelly suggested stake, price-capped. A hint; the owner sets real units on /track. */
  suggestedUnits: number;
  display?: PlayDisplay;
}

/**
 * How an ingest attempt actually went — the ONE vocabulary every adapter and
 * every cron route that pulls provider data reports through (Step 2, truthful
 * ingestion). "Did it throw?" is not enough: a provider can answer 200 and
 * hand back events that map to nothing we can store, which must read
 * differently from either a clean success or a legitimately quiet day.
 *
 *   ok        — usable records were fetched and stored (or matched/updated).
 *   empty     — ran fine; the provider legitimately had nothing for us (an
 *               off-season week, no active tournament, nothing left to grade).
 *   skipped   — did not run: disabled by a feature flag, or required
 *               credentials are absent. Distinct from `empty` — we never asked.
 *   unusable  — the provider responded (no throw) but zero usable records
 *               could be stored/matched from what it returned. This is the
 *               case a bare `ok: true` has historically hidden.
 *   error     — the attempt failed outright; `detail` carries a safe (no
 *               secrets) description.
 *
 * See src/lib/engine/ingestResult.ts for the shared classifier/builders.
 */
export type IngestStatus = "ok" | "empty" | "skipped" | "unusable" | "error";

/**
 * Counts an ingest path can surface, when the underlying fetch/store loop can
 * provide them. All optional — an adapter reports whichever of these it can
 * actually compute; it must not invent ones it can't.
 */
export interface IngestCounts {
  /** Raw items the provider returned, before any filtering/matching. */
  fetched?: number;
  /** Items that matched something we could act on (e.g. a known team/game). */
  matched?: number;
  /** Rows actually written/upserted. */
  stored?: number;
  /** Existing rows updated, where distinguishable from newly-created ones. */
  updated?: number;
  /** Items dropped as unusable (name mismatch, missing corner data, ...). */
  rejected?: number;
}

/**
 * Result of an adapter pulling its sport's data for a date.
 *
 * `ok` is derived, kept for callers still reading the old boolean: true for
 * `status` "ok" or "empty" (we have — or legitimately don't need — current
 * data), false for "skipped"/"unusable"/"error" (don't treat this run as
 * having produced fresh, usable data). Prefer reading `status`.
 */
export interface IngestSummary {
  sportKey: string;
  status: IngestStatus;
  /** @deprecated derived from `status` — see the interface doc. */
  ok: boolean;
  /** Short, human-readable, secret-free description of what happened. */
  detail: string;
  counts?: IngestCounts;
  [k: string]: unknown;
}

/** A market a sport offers. */
export interface MarketSpec {
  market: MarketType | null;
  kind: MarketKind;
  label: string;
}

/**
 * An open, adapter-declared prop type — replaces the closed MLB `StatCategory`
 * enum. Each sport declares its own prop menu; this is the door to "every prop
 * in every sport."
 */
export interface PropSpec {
  /** Stable key, e.g. "hits", "passing_yards", "aces". */
  key: string;
  label: string;
}

import type { CalibrationSample, CalibrationVerdict } from "./calibration";

/**
 * A model's last calibration result, baked onto the model so the board/Discord
 * can read its trust WITHOUT re-running a (DB-heavy) backtest live — the same
 * posture as the baked shrink constants. Refresh it whenever you re-run
 * `npm run backtest:<sport>`; docs/architecture/calibration.md tracks the numbers.
 */
export interface CalibrationSnapshot {
  verdict: CalibrationVerdict;
  brier: number;
  baseRateBrier: number;
  /** Settled events the verdict is based on. */
  n: number;
  /** ET date the backtest was last run, YYYY-MM-DD. */
  asOf: string;
}

/**
 * A model's ability to be backtested (Phase 4a). Turns settled history into
 * lookahead-safe {pred, won} samples the shared calibration harness can score —
 * the ONLY sport-specific part of calibration. Each model rebuilds its own
 * historical predictions "as of" each event (no future-data leakage), exactly as
 * scripts/backtest-ufc-calibration.ts does for UFC. Optional: a model may price
 * the card before it can be backtested, but it stays untrusted until it can.
 */
export interface ModelBacktest {
  /** What one sample is, for report headers. e.g. "priceable bout", "game moneyline". */
  readonly unit: string;
  /**
   * Rebuild the model's historical predictions, NEWEST FIRST (the harness's
   * time-split trains on the older tail). Each sample re-derives the probability
   * using only data available before its event. `limit` caps how many settled
   * events to walk back over.
   */
  collect(opts: { limit: number }): Promise<CalibrationSample[]>;
}

/**
 * Declares that a sport has a pricing model (so the board/preview can mark it
 * "modeled" vs "market-only"). Pricing itself is encapsulated inside the
 * adapter's `listPlays`; this is metadata, not the compute path.
 */
export interface SportModel {
  /** What the model prices, for docs/preview. e.g. "win prob + expected runs". */
  readonly describes: string;
  /**
   * Present when the model can be historically evaluated. The trust gate reads
   * the harness's verdict over these samples; a model with no `backtest` (or one
   * that hasn't cleared the bar) is priced but not trusted on the card.
   */
  readonly backtest?: ModelBacktest;
  /**
   * The last backtest's verdict, baked on so trust is readable without a live
   * backtest. Absent → never backtested (treat as untrusted). See `isModelTrusted`.
   */
  readonly calibration?: CalibrationSnapshot;
}

/**
 * The whole contract a sport implements to plug into the engine.
 *
 * `meta` reuses the existing `SportMeta` so nav can derive from the registry in
 * Phase 3. New sports beyond today's `NavSport` union widen it (or migrate to a
 * string key) at that point — see the design doc's open decisions.
 */
export interface SportAdapter {
  key: string;
  meta: SportMeta;
  /** Pull this sport's data into its own storage. Cron routes become thin wrappers over this. */
  ingest(dateEt: string): Promise<IngestSummary>;
  /**
   * Optional best-effort freshness step the board runs before listing (UFC pokes
   * its gated odds poll here). Omit when the sport's data is kept fresh out of
   * band (MLB's odds poll is a separate cron). Failures must not block the board.
   */
  refresh?(dateEt: string): Promise<void>;
  /** Priced +EV candidates for the board on a given date. */
  listPlays(dateEt: string): Promise<Play[]>;
  /** Present when the sport has a model; omit → plays carry market-only EV. */
  model?: SportModel;
  /** Grade one tracked play against its settled event (may return `pending`). */
  grade(play: Play): Promise<PlayGrade>;
  markets: MarketSpec[];
  props?: PropSpec[];
}
