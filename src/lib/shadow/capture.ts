/**
 * The NBA props shadow models' pregame records (docs/model-improvement-plan.md,
 * docs/alpha-sprint.md): for every main line production prices (the same
 * props, players and lines as the tracked leans — nbaStandouts with every call
 * kept), the chance of the Over from each forecaster, frozen together from one
 * slate read:
 *
 *   market     the books' no-vig chance at capture (every book hanging both sides)
 *   prodRaw    production's projection alone, before any shrink
 *   prodModel  production's model chance (calibration shrink, injury)
 *   prodBlend  production's market blend, before the side correction
 *   prodShown  the chance the product shows
 *   s1, s2     the v1 shadow (lib/shadow/nbaShadow)
 *   corr       v2's corrected projection under production's spread (the projection fix alone)
 *   v2         v2's corrected projection and distribution (lib/shadow/v2)
 *
 * v1 records (SHADOW_MODELS.nbaProps) keep their v1 shape. v2 records
 * (SHADOW_MODELS.nbaPropsV2) add corr, v2 and each side's market value with
 * the frozen candidate rule's verdict (lib/shadow/marketValue). Both settle
 * like any tracked lean and are read only by eval:shadow and the research
 * screen — never by the product's recommendations.
 */
import type { WireNbaPropsSlate } from "@/lib/queries/nbaProps";
import { summarizeProp, type GameLogPoint, type PropSummary } from "@/lib/nba/propsMath";
import { NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { projectProp, rawOver, type PropProjection } from "@/lib/nba/projection";
import { nbaStandouts, standoutContext, type Standout } from "@/lib/nba/standouts";
import { starterTonight } from "@/lib/nba/lineups";
import type { PredictionInput } from "@/lib/predictions";
import { fairOver } from "@/lib/tracking/capture";
import { SHADOW_PARAMS, SHADOW_VERSION, minutesFeatures, shadowDistribution, shadowProbOver, type ShadowDistribution } from "./nbaShadow";
import { V2_COMPONENTS, V2_PARAMS, V2_VERSION, correctedOnlyVariance, v2Distribution, v2Projection, type V2Component, type V2Projection } from "./v2";
import { CANDIDATE_RULE, markCandidates, valueRows, type SideValue, type ValueInput, type ValueRow } from "./marketValue";
import type { Forecaster } from "./forwardEval";

export const SHADOW_FEATURE_SCHEMA = "shadow-v1";
export const SHADOW_V2_FEATURE_SCHEMA = "shadow-v2";

type V1Forecaster = Exclude<Forecaster, "corr" | "v2">;

export interface ShadowFeatures {
  version: string;
  sport: "nba";
  stat: string;
  point: number;
  playerId: string;
  team: string;
  label: string;
  /** Each forecaster's chance of the Over (null where it has none). */
  over: Record<V1Forecaster, number | null>;
  /** Production's read: projected mean and SD, minutes, z (over terms), the side it leans. */
  prod: { mean: number; sd: number; minutes: number; z: number; side: "over" | "under" };
  /** The shadow's: s2 mean and SD, the minutes mixture's mean and miss scale, per-minute dispersion. */
  shadow: { mean: number; sd: number; s1Mean: number; minutesMean: number; minutesScale: number; phi: number };
  /** Best price on each side at capture, and how many books hung both sides. */
  market: { overPrice: number | null; underPrice: number | null; overBook: string | null; underBook: string | null; books: number };
  /** The minutes features, in MINUTES_FEATURES order. */
  minutesFeatures: number[];
}

/** A v2 record: the v1 fields, plus v2's own read and each side's market value. */
export interface ShadowV2Features extends Omit<ShadowFeatures, "over"> {
  over: Record<Forecaster, number | null>;
  v2: { mean: number; sd: number; minutes: number; minutesScale: number; z: number; components: { key: V2Component; prodMean: number; mean: number }[] };
  value: { over: CapturedSide | null; under: CapturedSide | null };
  /** The candidate rule in force, and this prop's rank among the slate's candidates (null: not a candidate). */
  candidate: { rule: string; side: "over" | "under"; rank: number } | null;
  injury: string | null;
  lineup: ValueInput["lineup"];
}

type CapturedSide = Pick<SideValue, "price" | "book" | "breakEven" | "noVig" | "noVigBooks" | "singleBook" | "ev" | "evS2" | "evV2" | "marketEv" | "warnings" | "quality" | "status" | "candidateReason" | "priceAgeMinutes">;

/** Everything one main-line prop's shadow read needs, built once (capture and the research screen share it). */
export interface ShadowRow {
  s: Standout;
  proj: PropProjection;
  base: PropSummary;
  playerLogs: GameLogPoint[];
  d1: ShadowDistribution;
  d2: ShadowDistribution;
  v2: { proj: V2Projection; dist: ShadowDistribution; over: number; z: number } | null;
  corrOver: number | null;
  over: Record<Forecaster, number | null>;
  injury: string | null;
  lineup: ValueInput["lineup"];
  games: number;
  books: number;
}

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

/** Every main line the slate's standout read prices (all of them, or those in `gameIds`), with each forecaster's chance. Pure. */
export function nbaShadowRows(slate: WireNbaPropsSlate, logs: Record<string, GameLogPoint[]>, gameIds: Set<string> | null): ShadowRow[] {
  const props = new Map(slate.props.map((p) => [`${p.playerId}|${p.stat}`, p]));
  const out: ShadowRow[] = [];
  const componentCache = new Map<string, Partial<Record<V2Component, PropProjection>>>();
  for (const s of nbaStandouts(slate, logs, { all: true })) {
    if (gameIds && !gameIds.has(s.gameId)) continue;
    const prop = props.get(`${s.playerId}|${s.stat}`);
    const player = slate.players[s.playerId];
    const stat = NBA_PROP_STAT_BY_KEY.get(s.stat as never);
    if (!prop || !player || !stat) continue;
    const playerLogs = logs[s.playerId] ?? [];
    const context = standoutContext(slate, player, s.stat);
    const base = summarizeProp(prop, playerLogs, stat, "over", context, s.point);
    const model = base?.model;
    const proj = model?.projection;
    if (!base || !model || !proj || !(proj.sd > 0)) continue;
    const d1 = shadowDistribution(proj, playerLogs, stat, "s1");
    const d2 = shadowDistribution(proj, playerLogs, stat, "s2");
    if (!d1 || !d2) continue;

    // v2: each component projected by production in the same context, then corrected.
    let components = componentCache.get(s.playerId);
    if (!components) {
      components = {};
      const projCtx = context.projection ? { season: slate.season, ...context.projection } : null;
      for (const c of ["points", "rebounds", "assists", "threes"] as const) {
        const p = projCtx ? projectProp(playerLogs, NBA_PROP_STAT_BY_KEY.get(c)!, projCtx) : null;
        if (p && p.minutes > 0) components[c] = p;
      }
      componentCache.set(s.playerId, components);
    }
    const vp = V2_COMPONENTS[s.stat] ? v2Projection(s.stat, components, playerLogs, slate.season) : null;
    const vd = vp ? v2Distribution(vp, proj, playerLogs, stat) : null;
    const v2 = vp && vd ? { proj: vp, dist: vd, over: shadowProbOver(vd, s.point), z: vd.sd > 0 ? (vd.mean - s.point) / vd.sd : 0 } : null;
    const corrOver = vp ? shadowProbOver({ components: [{ minutes: vp.minutes, mean: vp.mean, variance: correctedOnlyVariance(proj, vp.mean) }] }, s.point) : null;

    const quotes = prop.quotes.filter((q) => q.point === s.point);
    const overBooks = new Set(quotes.filter((q) => q.side === "over").map((q) => q.bookKey));
    const starter = starterTonight(slate.lineups, player.team?.abbreviation, player.name);
    out.push({
      s,
      proj,
      base,
      playerLogs,
      d1,
      d2,
      v2,
      corrOver,
      over: {
        market: fairOver(prop.quotes, s.point),
        prodRaw: rawOver(proj, s.point),
        prodModel: model.modelProbOver,
        // The tracked lean's own numbers (nba/standouts), in Over terms: the blend before the side
        // correction, and the chance the product shows (the corrected blend, or the old shrink without a market).
        prodBlend: s.side === "over" ? s.rawChance : 1 - s.rawChance,
        prodShown: s.side === "over" ? s.chance : 1 - s.chance,
        s1: shadowProbOver(d1, s.point),
        s2: shadowProbOver(d2, s.point),
        corr: corrOver,
        v2: v2?.over ?? null,
      },
      injury: player.injury?.level ?? null,
      lineup: starter === undefined ? "unconfirmed" : starter ? "confirmed-starter" : "confirmed-bench",
      games: playerLogs.filter((l) => l.minutes > 0).length,
      books: [...overBooks].filter((b) => quotes.some((q) => q.bookKey === b && q.side === "under")).length,
    });
  }
  return out;
}

/** The market-value engine's input for a row; `polledAt` gives each quote's read time ("player|stat|book|side|point"). */
export function valueInputOf(r: ShadowRow, quotes: WireNbaPropsSlate["props"][number]["quotes"], polledAt: (key: string) => Date | null): ValueInput {
  const s = r.s;
  return {
    id: `${s.gameId}|${s.playerId}|${s.stat}`,
    playerId: s.playerId,
    player: s.name,
    team: s.team,
    opponent: s.opponent,
    gameId: s.gameId,
    startsAt: s.startsAt,
    stat: s.stat,
    statLabel: s.statLabel,
    point: s.point,
    quotes: quotes
      .filter((q) => q.point === s.point)
      .map((q) => ({ bookKey: q.bookKey, bookName: q.bookName, side: q.side, priceAmerican: q.priceAmerican, polledAt: polledAt(`${s.playerId}|${s.stat}|${q.bookKey}|${q.side}|${q.point}`) })),
    rawOver: r.over.prodRaw,
    s2Over: r.over.s2,
    v2Over: r.over.v2,
    v2Z: r.v2?.z ?? null,
    minutes: r.v2?.proj.minutes ?? null,
    minutesScale: r.v2?.dist.minutesScale ?? null,
    injury: r.injury,
    lineup: r.lineup,
    games: r.games,
  };
}

/** The slate's shadow rows with their market value, the frozen rule applied. */
export function nbaValueBoard(slate: WireNbaPropsSlate, rows: ShadowRow[], polledAt: (key: string) => Date | null, now: Date): { rows: ShadowRow[]; values: ValueRow[]; candidates: string[] } {
  const props = new Map(slate.props.map((p) => [`${p.playerId}|${p.stat}`, p]));
  const values = valueRows(
    rows.map((r) => valueInputOf(r, props.get(`${r.s.playerId}|${r.s.stat}`)?.quotes ?? [], polledAt)),
    now
  );
  const candidates = markCandidates(values);
  return { rows, values, candidates };
}

function v1Features(r: ShadowRow): ShadowFeatures {
  const { s, proj, base, d1, d2, playerLogs } = r;
  const v1Over: Record<V1Forecaster, number | null> = {
    market: r.over.market,
    prodRaw: r.over.prodRaw,
    prodModel: r.over.prodModel,
    prodBlend: r.over.prodBlend,
    prodShown: r.over.prodShown,
    s1: r.over.s1,
    s2: r.over.s2,
  };
  return {
    version: SHADOW_VERSION,
    sport: "nba",
    stat: s.stat,
    point: s.point,
    playerId: s.playerId,
    team: s.team,
    label: `${s.name} Over ${s.point} ${s.statLabel}`,
    over: Object.fromEntries(Object.entries(v1Over).map(([k, v]) => [k, v === null ? null : round(v)])) as ShadowFeatures["over"],
    prod: { mean: round(proj.mean, 3), sd: round(proj.sd, 3), minutes: round(proj.minutes, 2), z: round(s.side === "over" ? s.z : -s.z, 4), side: s.side },
    shadow: { mean: round(d2.mean, 3), sd: round(d2.sd, 3), s1Mean: round(d1.mean, 3), minutesMean: round(d2.minutesMean, 2), minutesScale: round(d2.minutesScale, 3), phi: round(d2.phi, 3) },
    market: { overPrice: base.over?.priceAmerican ?? null, underPrice: base.under?.priceAmerican ?? null, overBook: base.over?.bookName ?? null, underBook: base.under?.bookName ?? null, books: r.books },
    minutesFeatures: minutesFeatures(proj, playerLogs).map((x) => round(x, 3)),
  };
}

const prediction = (r: ShadowRow, probability: number, features: object, projection: object): PredictionInput => ({
  eventRef: r.s.gameId,
  scheduledStartUtc: new Date(r.s.startsAt),
  marketKey: `prop:${r.s.stat}`,
  selectionKey: `${r.s.playerId}|over|${r.s.point}`,
  probability,
  projection: JSON.parse(JSON.stringify(projection)),
  featureSnapshot: JSON.parse(JSON.stringify(features)),
  marketSnapshot: { overPrice: r.base.over?.priceAmerican ?? null, underPrice: r.base.under?.priceAmerican ?? null, noVigOver: r.over.market },
});

/** The v1 shadow's pregame predictions for the props in `gameIds`. Pure. */
export function nbaShadowPredictions(slate: WireNbaPropsSlate, logs: Record<string, GameLogPoint[]>, gameIds: Set<string>): PredictionInput[] {
  return nbaShadowRows(slate, logs, gameIds).map((r) => {
    const f = v1Features(r);
    return prediction(r, r.over.s2!, f, { mean: f.shadow.mean, sd: f.shadow.sd });
  });
}

const capturedSide = (s: SideValue | null): CapturedSide | null =>
  s && {
    price: s.price,
    book: s.book,
    breakEven: round(s.breakEven),
    noVig: s.noVig === null ? null : round(s.noVig),
    noVigBooks: s.noVigBooks,
    singleBook: s.singleBook,
    ev: s.ev === null ? null : round(s.ev),
    evS2: s.evS2 === null ? null : round(s.evS2),
    evV2: s.evV2 === null ? null : round(s.evV2),
    marketEv: s.marketEv === null ? null : round(s.marketEv),
    warnings: s.warnings,
    quality: s.quality,
    status: s.status,
    candidateReason: s.candidateReason,
    priceAgeMinutes: s.priceAgeMinutes,
  };

/**
 * The v2 shadow's pregame predictions: every row v2 prices, with each side's
 * market value and the frozen candidate rule's picks for the slate. Pure.
 */
export function nbaShadowV2Predictions(
  slate: WireNbaPropsSlate,
  logs: Record<string, GameLogPoint[]>,
  gameIds: Set<string>,
  polledAt: (key: string) => Date | null,
  now: Date
): PredictionInput[] {
  const board = nbaValueBoard(slate, nbaShadowRows(slate, logs, gameIds), polledAt, now);
  const rank = new Map(board.candidates.map((id, i) => [id, i + 1]));
  return board.rows.flatMap((r, i) => {
    if (!r.v2 || r.over.v2 === null) return [];
    const v = board.values[i];
    const cand = (["over", "under"] as const).map((side) => ({ side, rank: rank.get(`${v.id}|${side}`) })).find((c) => c.rank !== undefined);
    const base = v1Features(r);
    const features: ShadowV2Features = {
      ...base,
      version: V2_VERSION,
      over: Object.fromEntries(Object.entries(r.over).map(([k, x]) => [k, x === null ? null : round(x)])) as ShadowV2Features["over"],
      v2: {
        mean: round(r.v2.dist.mean, 3),
        sd: round(r.v2.dist.sd, 3),
        minutes: round(r.v2.proj.minutes, 2),
        minutesScale: round(r.v2.dist.minutesScale, 3),
        z: round(r.v2.z, 4),
        components: r.v2.proj.components.map((c) => ({ key: c.key, prodMean: round(c.prodMean, 3), mean: round(c.mean, 3) })),
      },
      value: { over: capturedSide(v.over), under: capturedSide(v.under) },
      candidate: cand ? { rule: CANDIDATE_RULE.id, side: cand.side, rank: cand.rank! } : null,
      injury: r.injury,
      lineup: r.lineup,
    };
    return [prediction(r, r.over.v2, features, { mean: features.v2.mean, sd: features.v2.sd })];
  });
}

/** The constants each shadow ran with, frozen on each run. */
export const shadowRunSnapshot = () => ({ version: SHADOW_VERSION, params: JSON.parse(JSON.stringify(SHADOW_PARAMS)) });
export const shadowV2RunSnapshot = () => ({ version: V2_VERSION, params: JSON.parse(JSON.stringify(V2_PARAMS)), candidateRule: { ...CANDIDATE_RULE } });
