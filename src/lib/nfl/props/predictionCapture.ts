/**
 * Pure `LiveProjection` → `PredictionRunInput` builder for NFL props — the
 * forward record that later grading (against the nflverse box score) and any
 * future CLV check reads. No Prisma, no network. See
 * docs/architecture/MODEL-PREDICTION-LIFECYCLE.md.
 *
 * One `ModelPrediction` per (game, market, player): `eventRef` = the ESPN
 * event id (same key `/nfl/research` uses; nflverse game id if ESPN's is
 * missing), `marketKey` = `player_<market>`, `selectionKey` = GSIS player id.
 * `probability` is null — no line is attached at capture time — and the
 * projected mean plus its breakdown go in `projection`, from which an
 * over/under probability at any line is reproducible with the frozen model.
 */
import type { JsonValue, PredictionInput, PredictionRunInput } from "@/lib/predictions";
import {
  NFL_PROPS_FEATURE_SCHEMA_VERSION, NFL_PROPS_LIFECYCLE, NFL_PROPS_MODEL_KEY, NFL_PROPS_MODEL_VERSION, NFL_PROPS_SPORT_KEY,
  type FrozenModelFile,
} from "./frozen";
import type { LiveProjection, PropProjectionRow } from "./live";
import type { ServedMarket } from "./frozen";

export const PROP_MARKET_KEYS: Record<ServedMarket, string> = {
  receptions: "player_receptions",
  receivingYards: "player_receiving_yards",
  rushAttempts: "player_rush_attempts",
  rushingYards: "player_rushing_yards",
  passAttempts: "player_pass_attempts",
  completions: "player_completions",
  passingYards: "player_passing_yards",
  anytimeTd: "player_anytime_td",
  passingTds: "player_passing_tds",
};

export const MARKET_BY_KEY = Object.fromEntries(Object.entries(PROP_MARKET_KEYS).map(([m, k]) => [k, m])) as Record<string, ServedMarket>;

export function eventRefFor(row: Pick<PropProjectionRow, "game">): string {
  return row.game.espnId ?? row.game.gameId;
}

const r4 = (x: number | null) => (x === null ? null : +x.toFixed(4));

export function buildNflPropsPredictionRun(live: LiveProjection, model: FrozenModelFile, generatedAt: Date): PredictionRunInput {
  const predictions: PredictionInput[] = [];
  for (const row of live.rows) {
    if (!row.game.kickoffUtc) continue;
    predictions.push({
      eventRef: eventRefFor(row),
      scheduledStartUtc: row.game.kickoffUtc,
      marketKey: PROP_MARKET_KEYS[row.market],
      selectionKey: row.playerId,
      probability: null,
      projection: {
        mean: r4(row.mean),
        breakdown: {
          teamVolume: r4(row.breakdown.teamVolume),
          share: r4(row.breakdown.share),
          efficiency: r4(row.breakdown.efficiency),
          oppFactor: r4(row.breakdown.oppFactor),
          volumeLabel: row.breakdown.volumeLabel,
          efficiencyLabel: row.breakdown.efficiencyLabel,
        },
        seasonAvg: r4(row.seasonAvg),
        l5Avg: r4(row.l5Avg),
      },
      featureSnapshot: {
        name: row.name,
        position: row.position,
        headshotUrl: row.headshotUrl,
        team: row.team,
        opp: row.opp,
        home: row.game.home,
        away: row.game.away,
        nflverseGameId: row.game.gameId,
        season: row.game.season,
        week: row.game.week,
        spread: row.game.spread,
        total: row.game.total,
        priorGames: row.priorGames,
      },
      missingInputs: row.injury || row.availabilityNote ? { ...(row.injury ? { injuryReport: row.injury } : {}), ...(row.availabilityNote ? { teammatesOut: row.availabilityNote } : {}) } : null,
    });
  }
  return {
    sportKey: NFL_PROPS_SPORT_KEY,
    modelKey: NFL_PROPS_MODEL_KEY,
    modelVersion: NFL_PROPS_MODEL_VERSION,
    lifecycle: NFL_PROPS_LIFECYCLE,
    generatedAt,
    dataAsOfUtc: generatedAt,
    featureSchemaVersion: NFL_PROPS_FEATURE_SCHEMA_VERSION,
    calibrationSnapshot: { frozenAt: model.frozenAt, splits: model.splits, validation: model.validation, tdValidation: model.td?.validation ?? [] } as unknown as JsonValue,
    runMetadata: {
      season: live.season,
      week: live.week,
      games: live.games.length,
      excluded: live.excluded,
      dataAsOf: live.dataAsOf,
      warnings: live.warnings,
    } as unknown as JsonValue,
    predictions,
  };
}
