/**
 * Freezes ARCHR's leans shortly before each game (see types.ts): for every
 * NBA and NFL game starting within CAPTURE_HOURS that hasn't been captured,
 *
 *   - each prop at its main line, on the side ARCHR favors (the NBA's
 *     standout read, the NFL props model's blended chance against the
 *     market's), priced or a book's number awaiting its price;
 *   - each game line (moneyline, spread, total) on the side the game model
 *     favors against the market;
 *
 * one PredictionRun per tracked model per run, append-only. A game is
 * captured once: the latest read before tip, not a re-write every hour.
 */
import { prisma } from "@/lib/prisma";
import { formatSpreadPoint } from "@/lib/odds/americanOdds";
import { todayEt } from "@/lib/dateEt";
import { getLeagueDays } from "@/lib/queries/lobby";
import { getNbaPropsSlate, toWireSlate, type WireNbaPropsSlate } from "@/lib/queries/nbaProps";
import { unpackLog, type GameLogPoint } from "@/lib/nba/propsMath";
import { isStandout, nbaStandouts } from "@/lib/nba/standouts";
import { getNflPropsSlate, type NflPropsSlate } from "@/lib/queries/nflProps";
import { NFL_PROP_STAT_BY_KEY } from "@/lib/nfl/propStats";
import { summarizeNflProp, unpackNflLog } from "@/lib/nfl/propsMath";
import { nflProjectionContext } from "@/lib/nfl/slateContext";
import { listTeamLeagueGamesWithLines } from "@/lib/queries/teamLeagueGames";
import { getGameModelView } from "@/lib/queries/gameModel";
import { createPredictionRunBulk, type PredictionInput } from "@/lib/predictions";
import { LEAN_FEATURE_SCHEMA, TRACKED_MODELS, type LeanFeatures } from "./types";
import { regimeSnapshot, type RegimeSnapshot } from "./modelStamp";
import { confidenceOf, type ConfidenceInput } from "@/lib/propModel/confidence";

/** A game is captured once it starts within this many hours. */
export const CAPTURE_HOURS = 3;

export interface Lean {
  eventRef: string;
  startsAt: Date;
  marketKey: string;
  selectionKey: string;
  /** The chance the product displays for this lean (NBA props: the calibrated chance). */
  prob: number;
  features: LeanFeatures;
}

const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));

/**
 * The market's no-vig chance of the over at a number, from each book that hangs
 * both sides there, de-vigged and averaged: one book is enough (the live market
 * read wants several, and DraftKings is often the only book on the feed).
 */
export function fairOver(quotes: { bookKey: string; side: string; point: number; priceAmerican: number }[], point: number): number | null {
  const books = new Map<string, { over?: number; under?: number }>();
  for (const q of quotes) if (q.point === point) (books.get(q.bookKey) ?? books.set(q.bookKey, {}).get(q.bookKey)!)[q.side === "under" ? "under" : "over"] = q.priceAmerican;
  const fair = [...books.values()].flatMap((b) => (b.over !== undefined && b.under !== undefined ? [implied(b.over) / (implied(b.over) + implied(b.under))] : []));
  return fair.length ? fair.reduce((a, b) => a + b, 0) / fair.length : null;
}

/** De-vigs one pair of prices (the best on each side). */
const fairPair = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : implied(a) / (implied(a) + implied(b)));

/** The grade the product would show for a lean, frozen with it. */
export function leanConfidence(input: ConfidenceInput): LeanFeatures["confidence"] {
  const c = confidenceOf(input);
  return c ? { grade: c.grade, score: c.score } : undefined;
}

/** NBA props: every main line the standout read prices, on its side (Hottest Tonight's call, cut or not). */
export function nbaPropLeans(slate: WireNbaPropsSlate, logs: Record<string, GameLogPoint[]>, gameIds: Set<string>): Lean[] {
  const quotes = new Map(slate.props.map((p) => [`${p.playerId}|${p.stat}`, p.quotes]));
  return nbaStandouts(slate, logs, { all: true })
    .filter((s) => gameIds.has(s.gameId))
    .map((s) => {
      const over = s.marketChance === null ? fairOver(quotes.get(`${s.playerId}|${s.stat}`) ?? [], s.point) : null;
      const marketChance = s.marketChance ?? (over === null ? null : s.side === "over" ? over : 1 - over);
      return { s, marketChance };
    })
    .flatMap(({ s, marketChance }) => {
      const player = slate.players[s.playerId];
      const shared = {
        sampleGames: s.hit.season[1],
        blendVerdict: slate.blendVerdicts?.[s.stat] ?? null,
        injury: player?.injury?.level ?? null,
        minutes: s.minutes ? { projected: s.minutes, recent: null } : null,
        z: s.z,
        side: s.side,
        sport: "nba",
      } as const;
      const record = (l10: [number, number]): [number, number] => (l10[1] >= 5 ? l10 : s.hit.season);
      const main: Lean = {
      eventRef: s.gameId,
      startsAt: new Date(s.startsAt),
      marketKey: `prop:${s.stat}`,
      selectionKey: `${s.playerId}|${s.side}|${s.point}`,
      // The tracked probability is the chance the product DISPLAYS (calibrated),
      // not the pre-shrink rawChance — grading the raw number made every NBA
      // calibration/edge read systematically wrong (audit 2026-11-06, Lane 2 S1).
      prob: s.chance,
      features: {
        sport: "nba",
        kind: "prop",
        label: `${s.name} ${s.side === "over" ? "Over" : "Under"} ${s.point} ${s.statLabel}`,
        stat: s.stat,
        side: s.side,
        point: s.point,
        modelProb: s.modelChance,
        rawProb: s.rawChance,
        // Freeze the projection itself (Lane 2 S2): without mean/sd, settled
        // leans can never be decomposed into projection bias vs variance.
        // sd is recovered from z = (projection − point) / sd.
        projMean: s.projection,
        projSd: s.z !== 0 ? Math.abs((s.projection - s.point) / s.z) : null,
        marketProb: marketChance,
        price: s.priceAmerican,
        book: s.bookName,
        priced: s.priceAmerican !== null,
        playerId: s.playerId,
        team: s.team,
        z: s.z,
        minutes: s.minutes,
        standout: isStandout(s.z, s.rawChance, s.hit.l10),
        alt: false,
        confidence: leanConfidence({ ...shared, archr: s.chance, marketChance, priceAmerican: s.priceAmerican, rate: record(s.hit.l10), alt: false }),
      },
      };
      if (!s.alt) return [main];
      // The alternate line IS the Hottest Tonight recommendation (standouts'
      // best-value rung beyond the main line, same side) — until now it was
      // the one lean the product actually pushes that tracking never froze
      // (audit S-5 in Lane 2 / Phase 2 A3). It settles through the same box
      // score; settle.ts strips the ":alt" suffix for the stat lookup. Alt
      // rungs are one-sided, so there is no two-sided market read to freeze.
      const alt: Lean = {
        eventRef: s.gameId,
        startsAt: new Date(s.startsAt),
        marketKey: `prop:${s.stat}:alt`,
        selectionKey: `${s.playerId}|${s.side}|${s.alt.point}`,
        prob: s.alt.chance,
        features: {
          sport: "nba",
          kind: "prop",
          label: `${s.name} ${s.side === "over" ? "Over" : "Under"} ${s.alt.point} ${s.statLabel} (alt)`,
          stat: s.stat,
          side: s.side,
          point: s.alt.point,
          modelProb: null,
          rawProb: null,
          projMean: s.projection,
          projSd: s.z !== 0 ? Math.abs((s.projection - s.point) / s.z) : null,
          marketProb: null,
          price: s.alt.priceAmerican,
          book: s.alt.bookName,
          priced: true,
          playerId: s.playerId,
          team: s.team,
          z: s.z,
          minutes: s.minutes,
          standout: isStandout(s.z, s.rawChance, s.hit.l10),
          alt: true,
          confidence: leanConfidence({ ...shared, archr: s.alt.chance, marketChance: null, priceAmerican: s.alt.priceAmerican, rate: record(s.alt.l10), alt: true }),
        },
      };
      return [main, alt];
    });
}

/** NFL props: every prop a book has a number on, on the side the props model favors against the market (or even, with none). */
export function nflPropLeans(slate: NflPropsSlate, gameIds: Set<string>): Lean[] {
  const games = new Map(slate.games.map((g) => [g.id, g]));
  const out: Lean[] = [];
  for (const prop of slate.props) {
    const player = slate.players[prop.playerId];
    const stat = NFL_PROP_STAT_BY_KEY.get(prop.stat);
    const game = player && games.get(player.gameId);
    if (!player || !stat || !game || !gameIds.has(game.id)) continue;
    // A line a book hangs (priced, or its number awaiting the price); ARCHR's own lines have no market to be judged against.
    if (!prop.quotes.length && !prop.postedBook) continue;
    if (player.injury?.level === "out" || player.injury?.level === "doubtful") continue;
    const logs = (slate.logs[prop.playerId] ?? []).map(unpackNflLog);
    const ctx = {
      season: slate.season,
      venue: player.venue,
      opponent: player.opponent?.abbreviation ?? null,
      projection: nflProjectionContext(slate, player),
      injury: player.injury?.level ?? null,
      modelWeight: slate.modelWeights[prop.stat],
      calibrationFactor: slate.calibrationFactors[prop.stat],
    };
    const over = summarizeNflProp(prop, logs, stat, "over", ctx);
    const under = stat.shape === "anytime" ? null : summarizeNflProp(prop, logs, stat, "under", ctx);
    const m = over?.model;
    if (!over || !m) continue;
    const marketOver = m.market?.probOver ?? fairOver(prop.quotes, over.point) ?? (over.over ? implied(over.over.priceAmerican) : null);
    const base = marketOver ?? 0.5;
    const side = stat.shape === "anytime" || m.probOver >= base ? "over" : "under";
    if (side === "over" && stat.shape === "anytime" && marketOver === null && !over.over) continue; // a Yes with no price or market: nothing to judge
    const s = side === "over" ? over : under!;
    const quote = side === "over" ? s.over : s.under;
    const record = s.splits.find((x) => x.key === "l10" && x.rate.sampleSize >= 5) ?? s.splits.find((x) => x.key === "season");
    const marketSide = marketOver === null ? null : side === "over" ? marketOver : 1 - marketOver;
    const label = stat.shape === "anytime" ? `${player.name} anytime TD` : `${player.name} ${side === "over" ? "Over" : "Under"} ${s.point} ${stat.shortLabel}`;
    out.push({
      eventRef: game.id,
      startsAt: new Date(game.startUtc),
      marketKey: `prop:${prop.stat}`,
      selectionKey: `${prop.playerId}|${side}|${s.point}`,
      prob: side === "over" ? m.probOver : m.probUnder,
      features: {
        sport: "nfl",
        kind: "prop",
        label,
        stat: prop.stat,
        side,
        point: s.point,
        modelProb: side === "over" ? m.modelProbOver : 1 - m.modelProbOver,
        projMean: m.projection.mean,
        projSd: m.projection.sd,
        marketProb: marketOver === null ? null : side === "over" ? marketOver : 1 - marketOver,
        price: quote?.priceAmerican ?? null,
        book: quote?.bookName ?? s.postedBook ?? null,
        priced: Boolean(quote),
        playerId: prop.playerId,
        team: player.team?.abbreviation,
        injury: player.injury?.level ?? null,
        confidence: leanConfidence({
          archr: side === "over" ? m.probOver : m.probUnder,
          marketChance: marketSide,
          priceAmerican: quote?.priceAmerican ?? null,
          rate: record ? [record.rate.hits, record.rate.sampleSize] : [0, 0],
          sampleGames: m.projection.games,
          blendVerdict: slate.blendVerdicts?.[prop.stat] ?? null,
          injury: player.injury?.level ?? null,
          alt: false,
          z: ((m.projection.mean - s.point) / Math.max(m.projection.sd, 1e-6)) * (side === "over" ? 1 : -1),
          side,
          sport: "nfl",
        }),
      },
    });
  }
  return out;
}

/** Each game line on the side the game model favors against the market. */
async function gameLeans(sport: "nba" | "nfl", gameIds: Set<string>): Promise<Lean[]> {
  const games = (await listTeamLeagueGamesWithLines(sport)).filter((g) => gameIds.has(g.game.id) && g.lines.length);
  const out: Lean[] = [];
  for (const { game, lines } of games) {
    const view = await getGameModelView(sport, game.id, lines).catch(() => null);
    if (!view) continue;
    const home = game.homeTeam;
    const away = game.awayTeam;
    for (const m of view.markets) {
      if (m.market !== "ml" && m.point === null) continue;
      const marketA = m.marketRead?.probOver ?? fairPair(m.bestA?.priceAmerican, m.bestB?.priceAmerican);
      const a = m.probA >= (marketA ?? 0.5);
      const side = m.market === "total" ? (a ? "over" : "under") : a ? "home" : "away";
      const best = a ? m.bestA : m.bestB;
      const point = m.market === "ml" ? null : m.market === "spread" && !a ? -m.point! : m.point;
      const label =
        m.market === "ml" ? `${(a ? home : away).name} ML` : m.market === "spread" ? `${(a ? home : away).abbreviation} ${formatSpreadPoint(point!)}` : `${a ? "Over" : "Under"} ${point}`;
      out.push({
        eventRef: game.id,
        startsAt: game.scheduledStartUtc,
        marketKey: m.market,
        selectionKey: `${side}|${point ?? ""}`,
        prob: a ? m.probA : 1 - m.probA,
        features: {
          sport,
          kind: m.market,
          label,
          stat: m.market,
          side,
          point,
          modelProb: a ? m.modelProbA : 1 - m.modelProbA,
          marketProb: marketA === null ? null : a ? marketA : 1 - marketA,
          price: best?.priceAmerican ?? null,
          book: best?.bookName ?? null,
          priced: Boolean(best),
          team: m.market === "total" ? undefined : (a ? home : away).abbreviation,
        },
      });
    }
  }
  return out;
}

const toPrediction = (l: Lean): PredictionInput => ({
  eventRef: l.eventRef,
  scheduledStartUtc: l.startsAt,
  marketKey: l.marketKey,
  selectionKey: l.selectionKey,
  probability: l.prob,
  featureSnapshot: JSON.parse(JSON.stringify(l.features)),
  marketSnapshot: { price: l.features.price, book: l.features.book, marketProb: l.features.marketProb },
});

/** Games of a sport starting within the window, minus those this model already captured. */
async function due(sport: "nba" | "nfl", modelKey: string, now: Date, hours: number): Promise<Set<string>> {
  const games = await prisma.game.findMany({
    where: { sport, status: "scheduled", scheduledStartUtc: { gt: now, lte: new Date(now.getTime() + hours * 3_600_000) } },
    select: { id: true },
  });
  if (!games.length) return new Set();
  const done = await prisma.modelPrediction.findMany({
    where: { eventRef: { in: games.map((g) => g.id) }, run: { modelKey } },
    select: { eventRef: true },
    distinct: ["eventRef"],
  });
  const captured = new Set(done.map((d) => d.eventRef));
  return new Set(games.map((g) => g.id).filter((id) => !captured.has(id)));
}

async function write(sport: "nba" | "nfl", modelKey: string, leans: Lean[], now: Date, snapshot?: RegimeSnapshot): Promise<number> {
  // A run only holds leans for games that haven't started (the storage boundary insists).
  const fresh = leans.filter((l) => l.startsAt > now && Number.isFinite(l.prob));
  if (!fresh.length) return 0;
  // Capture-once is due()'s check plus this write, with a slow slate build in
  // between: a concurrent run can freeze the same game inside that window and
  // every metric would silently double-count it. Re-check at the write
  // boundary (audit 2026-11-06, Lane 2 S4) — the permanent fix is a per-game
  // capture-claim row written in the same transaction as the run.
  const ids = [...new Set(fresh.map((l) => l.eventRef))];
  const done = await prisma.modelPrediction.findMany({
    where: { eventRef: { in: ids }, run: { modelKey } },
    select: { eventRef: true },
    distinct: ["eventRef"],
  });
  const captured = new Set(done.map((d) => d.eventRef));
  const kept = fresh.filter((l) => !captured.has(l.eventRef));
  if (!kept.length) return 0;
  await createPredictionRunBulk({
    sportKey: sport,
    modelKey,
    modelVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    lifecycle: "experimental",
    generatedAt: now,
    dataAsOfUtc: now,
    featureSchemaVersion: LEAN_FEATURE_SCHEMA,
    // Freeze the fitted state (blend weights / calibration factors / verdicts
    // + their hash) on the run, so settled leans can later be cut by the
    // regime that produced them — "the model changed" vs "the model drifted"
    // (Phase 2 A3). Props models carry fitted state; game-line runs pass none.
    ...(snapshot ? { calibrationSnapshot: JSON.parse(JSON.stringify(snapshot)) } : {}),
    runMetadata: { games: new Set(kept.map((l) => l.eventRef)).size },
    predictions: kept.map(toPrediction),
  });
  return kept.length;
}

export interface CaptureSummary {
  [model: string]: { games: number; leans: number; sample?: Lean[] } | { error: string };
}

/** `dryRun` builds the leans without writing them (diagnose:leans); `hours` widens the window to look further ahead. */
export async function captureLeans(now = new Date(), opts: { dryRun?: boolean; hours?: number } = {}): Promise<CaptureSummary> {
  const out: CaptureSummary = {};
  const run = async (key: string, sport: "nba" | "nfl", build: (ids: Set<string>) => Promise<{ leans: Lean[]; snapshot?: RegimeSnapshot }>) => {
    try {
      const ids = await due(sport, key, now, opts.hours ?? CAPTURE_HOURS);
      if (!ids.size) return void (out[key] = { games: 0, leans: 0 });
      const { leans, snapshot } = await build(ids);
      if (opts.dryRun) {
        const kept = leans.filter((l) => l.startsAt > now && Number.isFinite(l.prob));
        return void (out[key] = { games: ids.size, leans: kept.length, sample: kept.slice(0, 4) });
      }
      out[key] = { games: ids.size, leans: await write(sport, key, leans, now, snapshot) };
    } catch (error) {
      out[key] = { error: error instanceof Error ? error.message.slice(0, 200) : String(error) };
    }
  };
  await run(TRACKED_MODELS.nbaProps, "nba", async (ids) => {
    const days = await getLeagueDays("nba", todayEt());
    const slate = toWireSlate(await getNbaPropsSlate(days[0] ?? todayEt()));
    const logs = Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackLog)])) as Record<string, GameLogPoint[]>;
    return { leans: nbaPropLeans(slate, logs, ids), snapshot: regimeSnapshot({ blendVerdicts: slate.blendVerdicts }) };
  });
  await run(TRACKED_MODELS.nflProps, "nfl", async (ids) => {
    const slate = await getNflPropsSlate(now);
    return {
      leans: nflPropLeans(slate, ids),
      snapshot: regimeSnapshot({ modelWeights: slate.modelWeights, calibrationFactors: slate.calibrationFactors, blendVerdicts: slate.blendVerdicts }),
    };
  });
  await run(TRACKED_MODELS.nbaGames, "nba", async (ids) => ({ leans: await gameLeans("nba", ids) }));
  await run(TRACKED_MODELS.nflGames, "nfl", async (ids) => ({ leans: await gameLeans("nfl", ids) }));
  return out;
}
