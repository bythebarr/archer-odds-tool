/**
 * The NBA screener's research mode: the familiar screen (same pool, same
 * filters, same production distance) with each row's experimental read beside
 * it — v2, s2, the books' no-vig chance, break-even, experimental and market
 * EV, minutes reliability, warnings — taken as-is from the research board
 * (lib/shadow/board → lib/shadow/marketValue). Nothing is recomputed here;
 * this module only matches rows to the board, says why a row has no read, and
 * adds the research sorts. Pure.
 *
 * Research only: the experimental numbers are being forward-tested
 * (docs/alpha-sprint.md); none is validated, and the 0.35 distance this mode
 * starts at is the audits' cut, not a validated edge.
 */
import type { SideValue, ValueRow } from "@/lib/shadow/marketValue";
import { V2_COMPONENTS } from "@/lib/shadow/v2";
import type { ScreenerProp } from "./types";

/** The distance research mode starts at (production's |z|, docs/performance-audit.md); adjustable, and 0 turns it off. */
export const RESEARCH_DEFAULT_DISTANCE = 0.35;

/** A row's experimental read, attached at render time (never stored in the pools). */
export type ResearchView =
  | {
      kind: "read";
      /** The board's side: its price, chances, EVs, warnings and status — the research page's own numbers. */
      side: SideValue;
      /** v2's expected minutes and predicted miss size; tonight's injury tag and lineup status. */
      minutes: number | null;
      minutesScale: number | null;
      injury: string | null;
      lineup: ValueRow["lineup"];
      /** The board's price differs from the row's (the pool and the board were read at different moments). */
      priceDiffers: boolean;
      /** Whether v2 points to this side, as production's projection does. */
      agreement: "agrees" | "disagrees" | "unknown";
    }
  | { kind: "missing"; reason: string };

/** "playerId:stat:side:point" from a screener row's id ("nba:<playerId>:<stat>:<side>:<point>"); null for any other shape. */
export function researchKeyOf(p: Pick<ScreenerProp, "id" | "sport">): string | null {
  if (p.sport !== "nba") return null;
  const parts = p.id.split(":");
  return parts.length === 5 && parts[0] === "nba" ? parts.slice(1).join(":") : null;
}

/** The board's sides by "playerId:stat:side:point". */
export function boardIndex(values: ValueRow[]): Map<string, { row: ValueRow; side: SideValue }> {
  const out = new Map<string, { row: ValueRow; side: SideValue }>();
  for (const row of values)
    for (const side of [row.over, row.under])
      if (side) out.set(`${row.playerId}:${row.stat}:${side.side}:${row.point}`, { row, side });
  return out;
}

/** Whether v2's projection points to this side the way production's does (both distances toward the side, ≥ 0 or < 0). */
export function agreementOf(prodZ: number | undefined, v2Distance: number | null): "agrees" | "disagrees" | "unknown" {
  if (prodZ === undefined || v2Distance === null) return "unknown";
  return prodZ >= 0 === v2Distance >= 0 ? "agrees" : "disagrees";
}

/** Each row's experimental read, or why it has none. */
export function attachResearch(rows: ScreenerProp[], values: ValueRow[]): Map<string, ResearchView> {
  const index = boardIndex(values);
  const lines = new Map(values.map((r) => [`${r.playerId}:${r.stat}`, r.point]));
  const out = new Map<string, ResearchView>();
  for (const p of rows) {
    const key = researchKeyOf(p);
    if (!key) {
      out.set(p.id, { kind: "missing", reason: "Experimental read is NBA-only" });
      continue;
    }
    const [player, stat] = key.split(":");
    if (!V2_COMPONENTS[stat!]) {
      out.set(p.id, { kind: "missing", reason: `v2 doesn't price ${p.statLabel}` });
      continue;
    }
    if (!p.main) {
      out.set(p.id, { kind: "missing", reason: "v2 prices main lines only" });
      continue;
    }
    if (p.side === "yes") {
      out.set(p.id, { kind: "missing", reason: "v2 prices over/under lines only" });
      continue;
    }
    const hit = index.get(key);
    if (!hit) {
      const boardLine = lines.get(`${player}:${stat}`);
      out.set(p.id, {
        kind: "missing",
        reason:
          boardLine !== undefined && boardLine !== p.point
            ? `Research board reads the main line at ${boardLine}, not ${p.point}`
            : "Not on the research board (game started, thin history, injury out, or a line outside his range)",
      });
      continue;
    }
    out.set(p.id, {
      kind: "read",
      side: hit.side,
      minutes: hit.row.minutes,
      minutesScale: hit.row.minutesScale,
      injury: hit.row.injury,
      lineup: hit.row.lineup,
      priceDiffers: p.priceAmerican !== null && p.priceAmerican !== hit.side.price,
      agreement: agreementOf(p.z, hit.side.distance),
    });
  }
  return out;
}

export type ResearchSort = "dist" | "v2ev" | "v2prob" | "v2gap" | "reliability";
export const RESEARCH_SORTS: { key: ResearchSort; label: string }[] = [
  { key: "dist", label: "Projection distance" },
  { key: "v2ev", label: "Experimental EV (not validated)" },
  { key: "v2prob", label: "v2 chance" },
  { key: "v2gap", label: "v2 minus sportsbook" },
  { key: "reliability", label: "Minutes reliability" },
];

/** A research sort's value (higher first); rows without the input sort last. */
export function researchSortValue(p: ScreenerProp, view: ResearchView | undefined, s: ResearchSort): number {
  if (s === "dist") return p.z ?? -Infinity;
  if (!view || view.kind !== "read") return -Infinity;
  const side = view.side;
  if (s === "v2ev") return side.ev ?? -Infinity;
  if (s === "v2prob") return side.v2Prob ?? -Infinity;
  if (s === "v2gap") return side.v2Prob !== null && side.noVig !== null ? side.v2Prob - side.noVig : -Infinity;
  // Reliability: the smaller the predicted minutes miss, the higher.
  return view.minutesScale === null ? -Infinity : -view.minutesScale;
}

/** Order already-screened rows by a research sort (ties keep the screen's own order). */
export function researchOrder(rows: ScreenerProp[], views: Map<string, ResearchView>, s: ResearchSort): ScreenerProp[] {
  return rows
    .map((p, i) => ({ p, i, v: researchSortValue(p, views.get(p.id), s) }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map((x) => x.p);
}

/**
 * The distance a research-mode screen starts at: the URL's when set (0 turns
 * it off), else RESEARCH_DEFAULT_DISTANCE. Other modes never get a default.
 */
export function researchDistance(dist: string | undefined, allowed: number[]): number {
  if (dist !== undefined && allowed.includes(Number(dist))) return Number(dist);
  return RESEARCH_DEFAULT_DISTANCE;
}
