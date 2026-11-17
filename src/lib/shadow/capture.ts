/**
 * The NBA props shadow model's pregame record (docs/model-improvement-plan.md):
 * for every main line production prices (the same props, players and lines as
 * the tracked leans — nbaStandouts with every call kept), the chance of the
 * Over from each forecaster, frozen together from one slate read:
 *
 *   market     the books' no-vig chance at capture (every book hanging both sides)
 *   prodRaw    production's projection alone, before any shrink
 *   prodModel  production's model chance (calibration shrink, injury)
 *   prodBlend  production's market blend, before the side correction
 *   prodShown  the chance the product shows
 *   s1, s2     the shadow (lib/shadow/nbaShadow)
 *
 * One ModelPrediction per prop: the Over at the main line (probability = s2),
 * every forecaster in its featureSnapshot. It settles like any tracked lean
 * (tracking/settle) and is read only by eval:shadow — never by the product.
 */
import type { WireNbaPropsSlate } from "@/lib/queries/nbaProps";
import { summarizeProp, type GameLogPoint } from "@/lib/nba/propsMath";
import { NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { rawOver } from "@/lib/nba/projection";
import { nbaStandouts, standoutContext } from "@/lib/nba/standouts";
import type { PredictionInput } from "@/lib/predictions";
import { fairOver } from "@/lib/tracking/capture";
import { SHADOW_PARAMS, SHADOW_VERSION, minutesFeatures, shadowDistribution, shadowProbOver } from "./nbaShadow";
import type { Forecaster } from "./forwardEval";

export const SHADOW_FEATURE_SCHEMA = "shadow-v1";

export interface ShadowFeatures {
  version: string;
  sport: "nba";
  stat: string;
  point: number;
  playerId: string;
  team: string;
  label: string;
  /** Each forecaster's chance of the Over (null where it has none). */
  over: Record<Forecaster, number | null>;
  /** Production's read: projected mean and SD, minutes, z (over terms), the side it leans. */
  prod: { mean: number; sd: number; minutes: number; z: number; side: "over" | "under" };
  /** The shadow's: s2 mean and SD, the minutes mixture's mean and miss scale, per-minute dispersion. */
  shadow: { mean: number; sd: number; s1Mean: number; minutesMean: number; minutesScale: number; phi: number };
  /** Best price on each side at capture, and how many books hung both sides. */
  market: { overPrice: number | null; underPrice: number | null; overBook: string | null; underBook: string | null; books: number };
  /** The minutes features, in MINUTES_FEATURES order. */
  minutesFeatures: number[];
}

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

/** The shadow's pregame predictions for the props in `gameIds`. Pure. */
export function nbaShadowPredictions(slate: WireNbaPropsSlate, logs: Record<string, GameLogPoint[]>, gameIds: Set<string>): PredictionInput[] {
  const props = new Map(slate.props.map((p) => [`${p.playerId}|${p.stat}`, p]));
  const out: PredictionInput[] = [];
  for (const s of nbaStandouts(slate, logs, { all: true })) {
    if (!gameIds.has(s.gameId)) continue;
    const prop = props.get(`${s.playerId}|${s.stat}`);
    const player = slate.players[s.playerId];
    const stat = NBA_PROP_STAT_BY_KEY.get(s.stat as never);
    if (!prop || !player || !stat) continue;
    const playerLogs = logs[s.playerId] ?? [];
    const base = summarizeProp(prop, playerLogs, stat, "over", standoutContext(slate, player, s.stat), s.point);
    const model = base?.model;
    const proj = model?.projection;
    if (!base || !model || !proj || !(proj.sd > 0)) continue;
    const d1 = shadowDistribution(proj, playerLogs, stat, "s1");
    const d2 = shadowDistribution(proj, playerLogs, stat, "s2");
    if (!d1 || !d2) continue;
    const quotes = prop.quotes.filter((q) => q.point === s.point);
    const books = new Set(quotes.filter((q) => q.side === "over").map((q) => q.bookKey));
    const pairs = [...books].filter((b) => quotes.some((q) => q.bookKey === b && q.side === "under")).length;
    const over: ShadowFeatures["over"] = {
      market: fairOver(prop.quotes, s.point),
      prodRaw: rawOver(proj, s.point),
      prodModel: model.modelProbOver,
      // The tracked lean's own numbers (nba/standouts), in Over terms: the blend before the side
      // correction, and the chance the product shows (the corrected blend, or the old shrink without a market).
      prodBlend: s.side === "over" ? s.rawChance : 1 - s.rawChance,
      prodShown: s.side === "over" ? s.chance : 1 - s.chance,
      s1: shadowProbOver(d1, s.point),
      s2: shadowProbOver(d2, s.point),
    };
    const features: ShadowFeatures = {
      version: SHADOW_VERSION,
      sport: "nba",
      stat: s.stat,
      point: s.point,
      playerId: s.playerId,
      team: s.team,
      label: `${s.name} Over ${s.point} ${s.statLabel}`,
      over: Object.fromEntries(Object.entries(over).map(([k, v]) => [k, v === null ? null : round(v)])) as ShadowFeatures["over"],
      prod: { mean: round(proj.mean, 3), sd: round(proj.sd, 3), minutes: round(proj.minutes, 2), z: round(s.side === "over" ? s.z : -s.z, 4), side: s.side },
      shadow: { mean: round(d2.mean, 3), sd: round(d2.sd, 3), s1Mean: round(d1.mean, 3), minutesMean: round(d2.minutesMean, 2), minutesScale: round(d2.minutesScale, 3), phi: round(d2.phi, 3) },
      market: { overPrice: base.over?.priceAmerican ?? null, underPrice: base.under?.priceAmerican ?? null, overBook: base.over?.bookName ?? null, underBook: base.under?.bookName ?? null, books: pairs },
      minutesFeatures: minutesFeatures(proj, playerLogs).map((x) => round(x, 3)),
    };
    out.push({
      eventRef: s.gameId,
      scheduledStartUtc: new Date(s.startsAt),
      marketKey: `prop:${s.stat}`,
      selectionKey: `${s.playerId}|over|${s.point}`,
      probability: over.s2,
      projection: { mean: features.shadow.mean, sd: features.shadow.sd },
      featureSnapshot: JSON.parse(JSON.stringify(features)),
      marketSnapshot: { overPrice: features.market.overPrice, underPrice: features.market.underPrice, noVigOver: over.market },
    });
  }
  return out;
}

/** The constants the shadow ran with, frozen on each run. */
export const shadowRunSnapshot = () => ({ version: SHADOW_VERSION, params: JSON.parse(JSON.stringify(SHADOW_PARAMS)) });
