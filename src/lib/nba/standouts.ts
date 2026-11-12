/**
 * Tonight's standout NBA props: the players ARCHR expects to clear their main
 * line by the most (or fall furthest short of it), with the reasons why and
 * the alternate line worth a look. Pure; the "Hottest tonight" page renders it.
 *
 * A prop stands out by how far ARCHR's projection sits from the book's main
 * line, measured in the player's own game-to-game spread for that stat (a
 * z-score): 3 points over is a lot for a 12-point scorer and little for a
 * 30-point one. It has to be backed, too: ARCHR's chance on that side at the
 * main line of at least MIN_CHANCE, and a record over his last ten games that
 * doesn't flatly disagree.
 *
 * The reasons are the projection's own inputs, in words: his minutes tonight
 * (teammates out, rest, a return, tonight's lineup, blowout risk), what the
 * opponent allows to his position, the game total, his recent form against
 * his season, and how he's done against this opponent, against teams that
 * play like it (styleMatch.ts), and at this venue.
 *
 * The alternate line: of the rungs a book hangs beyond the main line on that
 * side, the one with the best expected value at ARCHR's chance (a chance of at
 * least MIN_ALT_CHANCE, so it isn't a lottery ticket).
 *
 * The chance shown is calibrated (see STANDOUT_EDGE_SHRINK): picking the props
 * where ARCHR disagrees with the book most also picks the ones where its
 * projection is most often wrong, so the raw chance runs high on exactly these
 * calls. The page ranks by the calibrated chance, which the backtest finds
 * tracks hits; the size of the gap alone doesn't.
 */
import { americanToDecimal } from "@/lib/odds/americanOdds";
import { NBA_PROP_STAT_BY_KEY, type NbaPropStatDef } from "./propStats";
import { summarizeProp, type GameLogPoint, type PropContext, type PropSummary } from "./propsMath";
import { nbaProjectionContext } from "./slateContext";
import type { WireNbaPropsSlate, SlatePlayer } from "@/lib/queries/nbaProps";
import type { PropDirection } from "@/lib/props/tally";
import { mainPoint } from "@/lib/screener/types";
import { MAX_TRUSTED_RELATIVE_EDGE, relativeEdge } from "@/lib/builder/conservative";
import { styleRecord, type StyleRecord } from "./styleMatch";

/** The stats the page reads (milestones and the thin defensive stats are left out). */
export const STANDOUT_STATS = ["points", "rebounds", "assists", "threes", "pointsReboundsAssists", "pointsRebounds", "pointsAssists", "reboundsAssists"] as const;
export const MIN_CHANCE = 0.58;
export const MIN_Z = 0.35;
const MIN_ALT_CHANCE = 0.3;
/** His last-ten record on the side must be at least this. */
const MIN_L10 = 0.4;
const MIN_GAMES = 8;
/**
 * A main line this far from his last-10 average isn't his full-game line (a
 * partial-game market or a stray rung that reached the feed): the call is left
 * out rather than shouted.
 */
const LINE_RANGE = [0.55, 1.8] as const;
/**
 * How much of ARCHR's edge over the book's no-vig chance a standout keeps:
 * calibrated = market + k × (ARCHR − market), or around 50% with no two-sided
 * market. Fitted (log loss) by backtest:nba-standouts on the standouts it
 * replays; refit as nights of stored lines build up.
 */
export const STANDOUT_EDGE_SHRINK = 0.4;

/** ARCHR's chance on the side, shrunk toward the market's by STANDOUT_EDGE_SHRINK. */
export function calibrateStandout(raw: number, market: number | null, k = STANDOUT_EDGE_SHRINK): number {
  const anchor = market ?? 0.5;
  return anchor + k * (raw - anchor);
}

export interface Reason {
  text: string;
  /**
   * True when it points the same way as the call, false when against; null for
   * context only: past records (head-to-head, look-alike opponents, venue),
   * which the backtest finds don't predict whether the call hits.
   */
  supports: boolean | null;
}

export interface Standout {
  playerId: string;
  name: string;
  headshotUrl: string;
  team: string;
  opponent: string;
  gameId: string;
  game: string;
  startsAt: string;
  stat: string;
  statLabel: string;
  side: PropDirection;
  /** The book's main line and best price on that side. */
  point: number;
  priceAmerican: number | null;
  bookName: string | null;
  projection: number;
  /** Projection minus line, in his game-to-game spread. */
  z: number;
  /** ARCHR's calibrated chance on that side at the main line (see STANDOUT_EDGE_SHRINK): what the page shows and ranks by. */
  chance: number;
  /** Before calibration: the props model's chance (market blend included), and the market's no-vig chance alone. */
  rawChance: number;
  marketChance: number | null;
  /** The projection alone, before the market blend. */
  modelChance: number;
  /** Expected value of the best price at that chance. */
  ev: number | null;
  minutes: number | null;
  hit: { l5: [number, number]; l10: [number, number]; season: [number, number]; h2h: [number, number] };
  /** His record at the main line against teams that play like tonight's opponent; null when too few games. */
  style: StyleRecord | null;
  /** chance/ev: standout-adjusted (what picks the rung, unchanged); rawChance: ARCHR chance at the rung, before the adjustment. */
  alt: { point: number; priceAmerican: number; bookName: string; chance: number; rawChance: number; ev: number; l10: [number, number] } | null;
  reasons: Reason[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function rate(s: PropSummary, key: "l5" | "l10" | "season" | "h2h"): [number, number] {
  const r = s.hitRates[key];
  return [r.hits, r.sampleSize];
}

export function reasonsFor(
  s: PropSummary,
  side: PropDirection,
  stat: NbaPropStatDef,
  player: SlatePlayer,
  logs: GameLogPoint[],
  season: number,
  style: StyleRecord | null
): Reason[] {
  const proj = s.model?.projection;
  if (!proj) return [];
  const up = side === "over";
  const out: Reason[] = [];
  /** A reason that pushes the stat up (or down): it supports an over (or an under). */
  const add = (text: string, pushesUp: boolean) => out.push({ text, supports: pushesUp === up });
  /** A record already on the call's side: context, not a reason the call is stronger. */
  const record = (text: string) => out.push({ text, supports: null });
  const opp = player.opponent?.abbreviation ?? "the opponent";

  // Minutes and why they moved.
  const m = proj.minutesDetail;
  if (m) {
    if (m.absence > 1.03) add(`+${(proj.minutes - proj.minutes / m.absence).toFixed(1)} min with ${proj.absence?.names.join(", ") ?? "teammates"} out`, true);
    if (m.backToBack) add(`Second night of a back-to-back`, m.rest > 1);
    if (m.missed > 0) add(`First game back after missing ${m.missed} ${m.missed === 1 ? "game" : "games"}: minutes often managed`, false);
    if (m.roleChange > 1) add(`In tonight's starting five after coming off the bench`, true);
    if (m.roleChange < 1) add(`Out of tonight's starting five`, false);
  }
  if (proj.env.minutesFactor < 0.985) add(`${Math.abs(proj.env.spread ?? 0)}-point spread: blowout risk trims his minutes`, false);
  if (proj.env.minutesFactor > 1.015) add(`${Math.abs(proj.env.spread ?? 0)}-point spread: more bench run in a blowout`, true);
  // Opponent and environment.
  if (Math.abs(proj.matchupFactor - 1) >= 0.04)
    add(`${opp} ${proj.matchupFactor > 1 ? "gives up" : "holds"} ${pct(Math.abs(proj.matchupFactor - 1))} ${proj.matchupFactor > 1 ? "more" : "less"} ${stat.shortLabel} to ${player.positionGroup ? `${player.positionGroup}s` : "his position"} than average`, proj.matchupFactor > 1);
  if (Math.abs(proj.env.totalFactor - 1) >= 0.03 && proj.env.total !== null)
    add(`Game total ${proj.env.total}: ${proj.env.totalFactor > 1 ? "faster" : "slower"} than his usual games`, proj.env.totalFactor > 1);
  if (Math.abs(proj.paceFactor - 1) >= 0.02) add(`${opp} plays ${proj.paceFactor > 1 ? "fast" : "slow"}`, proj.paceFactor > 1);
  // Form and history.
  const values = logs.filter((l) => l.minutes > 0).map((l) => stat.value(l));
  const l5 = values.slice(0, 5);
  const seasonVals = logs.filter((l) => l.minutes > 0 && l.season === season).map((l) => stat.value(l));
  if (l5.length === 5 && seasonVals.length >= 8) {
    const a = l5.reduce((x, y) => x + y, 0) / 5;
    const b = seasonVals.reduce((x, y) => x + y, 0) / seasonVals.length;
    if (b > 0 && Math.abs(a / b - 1) >= 0.15) add(`${a > b ? "Hot" : "Cold"}: ${a.toFixed(1)} over his last 5 against ${b.toFixed(1)} this season`, a > b);
  }
  const h2h = s.hitRates.h2h;
  if (h2h.sampleSize >= 3) record(`${h2h.hits}/${h2h.sampleSize} ${up ? "over" : "under"} ${s.point} against ${opp}`);
  if (style) {
    const diff = style.avg - style.overall;
    const vsUsual = Math.abs(diff) >= 0.5 ? ` (${diff > 0 ? "+" : ""}${diff.toFixed(1)} on his usual)` : "";
    record(`vs teams like ${opp} (${style.teams.slice(0, 3).join(", ")}): ${style.hits}/${style.games} ${up ? "over" : "under"}, ${style.avg.toFixed(1)} a game${vsUsual}`);
  }
  // Home or away, only when the split leans hard one way.
  const venue = s.splits.find((x) => x.key === "venue");
  if (venue && venue.rate.sampleSize >= 6 && venue.avg !== null) {
    const r = venue.rate.hits / venue.rate.sampleSize;
    if (r >= 0.7 || r <= 0.3) record(`${venue.label}: ${venue.rate.hits}/${venue.rate.sampleSize} ${up ? "over" : "under"}, ${venue.avg.toFixed(1)} a game`);
  }
  // Supporting reasons first, then the ones against, then context.
  const order = (r: Reason) => (r.supports === true ? 0 : r.supports === false ? 1 : 2);
  return out.sort((a, b) => order(a) - order(b));
}

/** Whether a call clears the page's bar: the gap, ARCHR's raw chance, and a last-ten record that doesn't flatly disagree. */
export function isStandout(z: number, chance: number, [hits, games]: [number, number]): boolean {
  return Math.abs(z) >= MIN_Z && chance >= MIN_CHANCE && !(games >= 5 && hits / games < MIN_L10);
}

/**
 * Every standout prop on the slate, the best calibrated chance first. `all` keeps every
 * call, standout or not (the backtest compares the two).
 */
export function nbaStandouts(slate: WireNbaPropsSlate, logs: Record<string, GameLogPoint[]>, opts: { all?: boolean } = {}): Standout[] {
  const games = new Map(slate.games.map((g) => [g.id, g]));
  const out: Standout[] = [];
  for (const prop of slate.props) {
    if (!(STANDOUT_STATS as readonly string[]).includes(prop.stat) || !prop.quotes.length) continue;
    const player = slate.players[prop.playerId];
    const stat = NBA_PROP_STAT_BY_KEY.get(prop.stat);
    const game = player && games.get(player.gameId);
    if (!player || !stat || !game) continue;
    if (player.injury?.level === "out" || player.injury?.level === "doubtful") continue;
    const playerLogs = logs[prop.playerId] ?? [];
    if (playerLogs.filter((l) => l.minutes > 0).length < MIN_GAMES) continue;
    // The main line: the number hung on both sides (alt ladders are over-only), as the screener reads it.
    const main = mainPoint(prop.quotes);
    if (main === null) continue;
    const l10Values = playerLogs.filter((l) => l.minutes > 0).slice(0, 10).map((l) => stat.value(l));
    const l10Avg = l10Values.reduce((a, b) => a + b, 0) / l10Values.length;
    if (l10Avg >= 2 && (main < LINE_RANGE[0] * l10Avg || main > LINE_RANGE[1] * l10Avg)) continue;
    const context: PropContext = {
      season: slate.season,
      venue: player.venue,
      opponent: player.opponent?.abbreviation,
      projection: nbaProjectionContext(slate, player),
      injury: player.injury?.level ?? null,
      modelWeight: slate.modelWeights[prop.stat],
      calibrationFactor: slate.calibrationFactors?.[prop.stat],
    };
    const base = summarizeProp(prop, playerLogs, stat, "over", context, main);
    const proj = base?.model?.projection;
    if (!base?.model || !proj || proj.sd <= 0) continue;
    const z = (proj.mean - main) / proj.sd;
    const side: PropDirection = z >= 0 ? "over" : "under";
    const s = side === "over" ? base : summarizeProp(prop, playerLogs, stat, "under", context, main)!;
    const rawChance = side === "over" ? base.model.probOver : base.model.probUnder;
    const market = base.model.market ? (side === "over" ? base.model.market.probOver : 1 - base.model.market.probOver) : null;
    const chance = calibrateStandout(rawChance, market);
    const l10 = rate(s, "l10");
    if (!opts.all && !isStandout(z, rawChance, l10)) continue;
    const quote = side === "over" ? s.over : s.under;
    const style = styleRecord(playerLogs, slate.defense, player.opponent?.abbreviation, stat, player.positionGroup, side, main);

    // The alternate line: the best-value rung beyond the main line on this side.
    let alt: Standout["alt"] = null;
    for (const point of s.points) {
      if (side === "over" ? point <= main : point >= main) continue;
      const at = summarizeProp(prop, playerLogs, stat, side, context, point);
      const q = side === "over" ? at?.over : at?.under;
      const rawAt = at?.model ? (side === "over" ? at.model.probOver : at.model.probUnder) : null;
      // Alt rungs are one-sided (no market to shrink toward): take off the same overstatement as at the main line.
      const c = rawAt === null ? null : Math.max(0, rawAt - (rawChance - chance));
      if (!at || !q || c === null || c < MIN_ALT_CHANCE) continue;
      // A price far longer than the chance says isn't value, it's a price that doesn't belong to the rung.
      if ((relativeEdge(c, q.priceAmerican) ?? 0) > MAX_TRUSTED_RELATIVE_EDGE) continue;
      const ev = c * americanToDecimal(q.priceAmerican) - 1;
      if (!alt || ev > alt.ev) alt = { point, priceAmerican: q.priceAmerican, bookName: q.bookName, chance: c, rawChance: rawAt!, ev, l10: rate(at, "l10") };
    }

    out.push({
      playerId: player.id,
      name: player.name,
      headshotUrl: player.headshotUrl,
      team: player.team?.abbreviation ?? "",
      opponent: player.opponent?.abbreviation ?? "",
      gameId: game.id,
      game: `${game.away.abbreviation} @ ${game.home.abbreviation}`,
      startsAt: game.startUtc,
      stat: prop.stat,
      statLabel: stat.shortLabel,
      side,
      point: main,
      priceAmerican: quote?.priceAmerican ?? null,
      bookName: quote?.bookName ?? null,
      projection: proj.mean,
      z,
      chance,
      rawChance,
      marketChance: market,
      modelChance: side === "over" ? base.model.modelProbOver : 1 - base.model.modelProbOver,
      ev: quote ? chance * americanToDecimal(quote.priceAmerican) - 1 : null,
      minutes: proj.minutes,
      hit: { l5: rate(s, "l5"), l10, season: rate(s, "season"), h2h: rate(s, "h2h") },
      style,
      alt,
      reasons: reasonsFor(s, side, stat, player, playerLogs, slate.season, style),
    });
  }
  return out.sort((a, b) => b.chance - a.chance || Math.abs(b.z) - Math.abs(a.z));
}
