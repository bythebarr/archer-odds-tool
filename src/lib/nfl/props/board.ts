/**
 * Reads the most recent `nfl-props` PredictionRun and shapes it for
 * `/nfl/props`. Read-only; the numbers are exactly what was frozen at capture
 * (see `predictionCapture.ts`) — the page never re-projects.
 */
import { prisma } from "@/lib/prisma";
import { NFL_TEAMS } from "../teams";
import { NFL_PROPS_MODEL_KEY, type ValidationRow } from "./frozen";
import { MARKET_BY_KEY } from "./predictionCapture";
import type { PropMarket } from "./model";

export interface NflPropsBoardGame {
  eventRef: string;
  kickoffUtc: string;
  home: TeamDisplay;
  away: TeamDisplay;
  spread: number | null;
  total: number | null;
}

export interface TeamDisplay {
  code: string;
  abbreviation: string;
  name: string;
}

export interface NflPropsBoardRow {
  eventRef: string;
  market: PropMarket;
  playerId: string;
  name: string;
  position: string;
  headshotUrl: string | null;
  team: TeamDisplay;
  opp: TeamDisplay;
  mean: number;
  breakdown: {
    teamVolume: number;
    share: number;
    efficiency: number | null;
    oppFactor: number | null;
    volumeLabel: string;
    efficiencyLabel: string | null;
  };
  seasonAvg: number | null;
  l5Avg: number | null;
  priorGames: number;
  injury: string | null;
}

export interface NflPropsBoard {
  runId: string;
  modelVersion: string;
  generatedAt: string;
  season: number;
  week: number;
  games: NflPropsBoardGame[];
  rows: NflPropsBoardRow[];
  excluded: { name: string; team: string; reason: string }[];
  warnings: string[];
  validation: ValidationRow[];
}

/** nflverse team code → this app's display identity (nflverse codes the Rams "LA"; the app shows "LAR"). */
export function nflDisplayTeam(code: string): TeamDisplay {
  const abbreviation = code === "LA" ? "LAR" : code;
  const team = NFL_TEAMS.find((t) => t.abbreviation === abbreviation);
  return { code, abbreviation, name: team?.name ?? code };
}

type Json = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function getLatestNflPropsBoard(): Promise<NflPropsBoard | null> {
  const run = await prisma.predictionRun.findFirst({
    where: { modelKey: NFL_PROPS_MODEL_KEY },
    orderBy: { generatedAt: "desc" },
    include: { predictions: true },
  });
  if (!run) return null;
  const meta = (run.runMetadata ?? {}) as Json;
  const calibration = (run.calibrationSnapshot ?? {}) as Json;

  const games = new Map<string, NflPropsBoardGame>();
  const rows: NflPropsBoardRow[] = [];
  for (const p of run.predictions) {
    const market = MARKET_BY_KEY[p.marketKey];
    if (!market) continue;
    const f = p.featureSnapshot as Json;
    const proj = (p.projection ?? {}) as Json;
    const bd = (proj.breakdown ?? {}) as Json;
    const missing = (p.missingInputs ?? {}) as Json;
    if (!games.has(p.eventRef)) {
      games.set(p.eventRef, {
        eventRef: p.eventRef,
        kickoffUtc: p.scheduledStartUtc.toISOString(),
        home: nflDisplayTeam(String(f.home)),
        away: nflDisplayTeam(String(f.away)),
        spread: num(f.spread),
        total: num(f.total),
      });
    }
    rows.push({
      eventRef: p.eventRef,
      market,
      playerId: p.selectionKey,
      name: String(f.name),
      position: String(f.position),
      headshotUrl: typeof f.headshotUrl === "string" ? f.headshotUrl : null,
      team: nflDisplayTeam(String(f.team)),
      opp: nflDisplayTeam(String(f.opp)),
      mean: num(proj.mean) ?? 0,
      breakdown: {
        teamVolume: num(bd.teamVolume) ?? 0,
        share: num(bd.share) ?? 0,
        efficiency: num(bd.efficiency),
        oppFactor: num(bd.oppFactor),
        volumeLabel: String(bd.volumeLabel ?? ""),
        efficiencyLabel: typeof bd.efficiencyLabel === "string" ? bd.efficiencyLabel : null,
      },
      seasonAvg: num(proj.seasonAvg),
      l5Avg: num(proj.l5Avg),
      priorGames: num(f.priorGames) ?? 0,
      injury: typeof missing.injuryReport === "string" ? missing.injuryReport : null,
    });
  }

  return {
    runId: run.id,
    modelVersion: run.modelVersion,
    generatedAt: run.generatedAt.toISOString(),
    season: num(meta.season) ?? 0,
    week: num(meta.week) ?? 0,
    games: [...games.values()].sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc)),
    rows,
    excluded: Array.isArray(meta.excluded) ? (meta.excluded as NflPropsBoard["excluded"]) : [],
    warnings: Array.isArray(meta.warnings) ? (meta.warnings as string[]) : [],
    validation: Array.isArray(calibration.validation) ? (calibration.validation as ValidationRow[]) : [],
  };
}
