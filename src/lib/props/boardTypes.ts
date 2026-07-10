import type { PropDirection, PropHitRateResult } from "./hitRate";
import type { PropProjection } from "./projection";

/**
 * Sport-agnostic prop-board contract. Every sport plugs in a SportPropConfig
 * (its stat catalog + split dimensions + a board builder); the board UI and
 * the getPropBoard entry point are generic over this shape. MLB is the first
 * implementation; UFC/tennis/etc. slot in by adding a config, no UI changes.
 *
 * The universal model: a prop is an ENTITY's STAT in an upcoming event, over a
 * LINE. The hit rate is how often that stat cleared the line across the
 * entity's recent event log, sliced by WINDOW (L5/L10/…) and SPLIT (the
 * sport's own dimensions — MLB vs LHP/RHP, UFC vs southpaw, tennis by surface).
 */
export type PropSport = "mlb"; // widened as sports are added

/** A stat category a sport offers props on (MLB hits, UFC significant strikes…). */
export interface PropStatDef {
  /** Sport-unique key (kept === the sport's own stat identifier where one exists). */
  key: string;
  label: string;
  shortLabel: string;
  /** Who the prop is about, for grouping/labels — e.g. "Batter", "Pitcher", "Fighter". */
  role?: string;
  /** The alt-lines to rank hit rate across — the "increments" a user sorts through. */
  standardLines: number[];
}

/**
 * One hit-rate column on the board — either a recency WINDOW (L5, Season) or a
 * SPLIT option (vs LHP). Sports declare whichever columns are meaningful for
 * them; the board renders exactly these.
 */
export interface PropBoardColumnDef {
  key: string;
  label: string;
  kind: "window" | "split";
}

/** A single alt-line's hit-rate cells for one entity, keyed by column. */
export interface PropLineCells {
  line: number;
  /** columnKey -> hit rate (null = no sample for that window/split). */
  cells: Record<string, PropHitRateResult | null>;
  /**
   * Archer Prop Projection: the calibrated next-game P(clears the line) for
   * this line (see props/projection.ts), the honest counterweight to the raw
   * trailing hit-rate cells. Null when there's no season sample to project
   * from, or when the sport's builder doesn't compute one yet.
   */
  projection?: PropProjection | null;
}

/** One board row = one entity's prop for the active stat, across all its lines. */
export interface PropBoardRow {
  sport: PropSport;
  id: string;
  entityId: string;
  entityName: string;
  /** Headshot/logo URL, or null — rendered with an initials fallback. */
  entityImageUrl: string | null;
  /** Short context, e.g. "vs CLE" or the matchup. */
  meta: string | null;
  statKey: string;
  direction: PropDirection;
  lines: PropLineCells[];
  /** PAID-EV SEAM: live prop-odds edge, null until paid props-odds coverage lands. */
  ev: null;
}

export interface PropBoard {
  sport: PropSport;
  date: string;
  /** View tabs within the sport (MLB Batters/Pitchers; UFC Striking/Grappling…). */
  views: { key: string; label: string }[];
  activeView: string;
  /** Stat chips for the active view. */
  stats: { key: string; label: string; shortLabel: string; role?: string }[];
  activeStatKey: string;
  /** The active stat's alt-lines, for the increment selector. */
  lines: number[];
  /** Window + split columns for the active view. */
  columns: PropBoardColumnDef[];
  rows: PropBoardRow[];
}

/**
 * A coherent (population + splits + stat-catalog) bundle within a sport. MLB
 * Batters and Pitchers are two views: different entities (recent batters vs
 * probable starters) and different meaningful splits (vs LHP/RHP vs home/away).
 * The board UI is generic over views, so a sport exposes as many as it needs.
 */
export interface PropView {
  key: string;
  label: string;
  stats: PropStatDef[];
  columns: PropBoardColumnDef[];
  /** Build the day's rows for one stat (all entities × the stat's lines). */
  buildBoard: (dateEt: string, statKey: string) => Promise<PropBoardRow[]>;
}

/** What each sport implements to appear on the universal board. */
export interface SportPropConfig {
  sport: PropSport;
  label: string;
  icon: string;
  views: PropView[];
}
