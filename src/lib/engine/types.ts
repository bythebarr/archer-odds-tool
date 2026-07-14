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
import type { SportMeta } from "@/lib/sports";

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

/** Result of an adapter pulling its sport's data for a date. */
export interface IngestSummary {
  sportKey: string;
  ok: boolean;
  detail?: string;
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

/**
 * Declares that a sport has a pricing model (so the board/preview can mark it
 * "modeled" vs "market-only"). Pricing itself is encapsulated inside the
 * adapter's `listPlays`; this is metadata, not the compute path.
 */
export interface SportModel {
  /** What the model prices, for docs/preview. e.g. "win prob + expected runs". */
  readonly describes: string;
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
  /** Priced +EV candidates for the board on a given date. */
  listPlays(dateEt: string): Promise<Play[]>;
  /** Present when the sport has a model; omit → plays carry market-only EV. */
  model?: SportModel;
  /** Grade one tracked play against its settled event (may return `pending`). */
  grade(play: Play): Promise<PlayGrade>;
  markets: MarketSpec[];
  props?: PropSpec[];
}
