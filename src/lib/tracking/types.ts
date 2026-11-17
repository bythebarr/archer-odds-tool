/**
 * Pick tracking: what ARCHR leaned on, before the game, and how it went.
 *
 *   capture.ts  — shortly before each game, every lean the models make (each
 *                 prop at its main line on the side ARCHR favors, each game
 *                 line's favored side) is frozen into ModelPrediction rows.
 *   settle.ts   — after the game, each is graded off the box score and the
 *                 final score, with the closing line beside it, into
 *                 PredictionSettlement.
 *   evaluate.ts — the graded leans, cut every way (sport, market, stat, side,
 *                 edge size, confidence, price), scored on hit rate against
 *                 what ARCHR said, profit at the price, closing-line value and
 *                 accuracy against the market: which edges hold up and which
 *                 don't. Pure.
 */

/** The models whose leans are tracked (ModelPrediction's run.modelKey). */
export const TRACKED_MODELS = {
  nbaProps: "track:nba-props",
  nflProps: "track:nfl-props",
  nbaGames: "track:nba-games",
  nflGames: "track:nfl-games",
} as const;

/** Bumped when the featureSnapshot shape changes. */
export const LEAN_FEATURE_SCHEMA = "lean-v2";

/** Every schema version evaluation knows how to read. Rows stamped with
 * anything else are skipped by readers (edgeReport) instead of being cast
 * blind — a future shape bump must add itself here deliberately. */
export const KNOWN_LEAN_SCHEMAS: readonly string[] = ["lean-v1", "lean-v2"];

export type LeanKind = "prop" | "ml" | "spread" | "total";

/** What each tracked prediction's featureSnapshot holds: the keys evaluation cuts on. */
export interface LeanFeatures {
  sport: "nba" | "nfl";
  kind: LeanKind;
  /** Readable: "Jalen Brunson Over 26.5 PTS", "BOS −3.5". */
  label: string;
  /** Prop stat key ("points"), or the game market. */
  stat: string;
  /** "over" | "under" | "home" | "away". */
  side: string;
  point: number | null;
  /** ARCHR's chance before the market blend. */
  modelProb: number | null;
  /** NBA props (lean-v2): the blended chance BEFORE the display calibration
   * shrink. `probability` on the row is the calibrated chance Sam sees; this
   * keeps the raw number gradable as its own dimension. */
  rawProb?: number | null;
  /** The frozen projection itself (lean-v2): the projected stat mean and its
   * spread, so settlement can decompose error into bias vs variance instead
   * of only hit/miss. Null where the model exposes no projection. */
  projMean?: number | null;
  projSd?: number | null;
  /** The market's no-vig chance at this number; null with no two-sided market. */
  marketProb: number | null;
  /** Best price on this side; null when the book posted the number without a price. */
  price: number | null;
  book: string | null;
  /** Priced by a book, or only a book's number (NFL props midweek, ESPN). */
  priced: boolean;
  /** Prop extras, where the model reads them. */
  playerId?: string;
  team?: string;
  z?: number;
  minutes?: number | null;
  /** The NBA Hottest Tonight bar. */
  standout?: boolean;
  /** NBA props (Phase 2 A3): true for the alternate-line lean (marketKey
   * "prop:<stat>:alt") — the rung Hottest Tonight actually recommends —
   * false for the main line. Absent on leans captured before alt tracking. */
  alt?: boolean;
  injury?: string | null;
  /** Props: the Confidence grade (lib/propModel/confidence) as the product showed it when the lean was frozen —
   * so the grade is checked on real games going forward, not only on replayed closing lines. */
  confidence?: { grade: "A" | "B" | "C" | "D"; score: number };
  /** NBA props: his record at this line on this side before the game, as the screener counts it (L5, L10, L15, this season). Absent before 2026-11-17. */
  rates?: { l5: [number, number]; l10: [number, number]; l15: [number, number]; szn: [number, number] };
  /** NBA props: the named screener sets (lib/tracking/screens) this lean passed when frozen. Absent before 2026-11-17. */
  screens?: string[];
}

export type SettleResult = "hit" | "miss" | "push" | "void";

/** One settled lean, as evaluation reads it. */
export interface GradedLean {
  features: LeanFeatures;
  /** The game (Game.id). */
  eventRef?: string;
  /** His stat that night (props), from the settlement. */
  actual?: number | null;
  /**
   * NBA props, read AFTER the game (never at capture): his actual minutes and his
   * team's final margin, for the "why it lost" cuts. Undefined where not loaded.
   */
  post?: { minutes: number | null; margin: number | null };
  /** The displayed chance on this side when captured (NBA props: calibrated; the pre-calibration blend is kept in features.rawProb). */
  prob: number;
  result: SettleResult;
  closingProb: number | null;
  startsAt: Date;
  /** The producing run's code version (git SHA), when the reader joined it. */
  modelVersion?: string | null;
  /** Code version + fitted-state hash (lib/tracking/modelStamp): the regime
   * segment this lean belongs to, for "model changed vs model drifted" cuts. */
  versionSegment?: string | null;
}
