/**
 * Every fighter's UFC fight log (lib/ufc/propModel.ts UfcFightLog) and each
 * weight class's per-minute averages, from the bout tables. Shared by the
 * fighter sheet, the props slate and the props backtest.
 */
import { prisma } from "@/lib/prisma";
import { fightSeconds, weightClassLbs } from "./fightModel";
import type { DivisionPrior, UfcFightLog, UfcLogLine } from "./propModel";

/** "Women's Flyweight" → "w125"; "Light Heavyweight" → "205"; unknown → "open". */
export function divisionKey(weightClass: string): string {
  const lbs = weightClassLbs(weightClass);
  if (!lbs) return "open";
  return `${/women/i.test(weightClass) ? "w" : ""}${lbs}`;
}

const LINE_SELECT = {
  fighterId: true,
  significantStrikesLanded: true,
  significantStrikesAttempted: true,
  totalStrikesLanded: true,
  takedownsLanded: true,
  takedownsAttempted: true,
  knockdowns: true,
  submissionAttempts: true,
  controlTimeSeconds: true,
  headStrikesLanded: true,
  bodyStrikesLanded: true,
  legStrikesLanded: true,
  distanceStrikesLanded: true,
  clinchStrikesLanded: true,
  groundStrikesLanded: true,
} as const;

type LineRow = {
  significantStrikesLanded: number;
  significantStrikesAttempted: number;
  totalStrikesLanded: number;
  takedownsLanded: number;
  takedownsAttempted: number;
  knockdowns: number;
  submissionAttempts: number;
  controlTimeSeconds: number;
  headStrikesLanded: number;
  bodyStrikesLanded: number;
  legStrikesLanded: number;
  distanceStrikesLanded: number;
  clinchStrikesLanded: number;
  groundStrikesLanded: number;
};

export function toLogLine(s: LineRow): UfcLogLine {
  return {
    sig: s.significantStrikesLanded,
    sigAtt: s.significantStrikesAttempted,
    total: s.totalStrikesLanded,
    td: s.takedownsLanded,
    tdAtt: s.takedownsAttempted,
    kd: s.knockdowns,
    sub: s.submissionAttempts,
    ctrl: s.controlTimeSeconds,
    head: s.headStrikesLanded,
    body: s.bodyStrikesLanded,
    leg: s.legStrikesLanded,
    distance: s.distanceStrikesLanded,
    clinch: s.clinchStrikesLanded,
    ground: s.groundStrikesLanded,
  };
}

export interface UfcBoutForLogs {
  id: string;
  date: Date;
  weightClass: string;
  red: string;
  blue: string;
  redName: string;
  blueName: string;
  winner: string | null;
  method: string | null;
  round: number | null;
  time: string | null;
  scheduledRounds: number;
  redLine: UfcLogLine | null;
  blueLine: UfcLogLine | null;
}

/** Completed bouts (oldest first) for `fighterIds`, or every bout when omitted. */
export async function loadUfcBouts(fighterIds?: string[]): Promise<UfcBoutForLogs[]> {
  const rows = await prisma.ufcBout.findMany({
    where: { status: "completed", ...(fighterIds ? { OR: [{ redCornerFighterId: { in: fighterIds } }, { blueCornerFighterId: { in: fighterIds } }] } : {}) },
    orderBy: [{ event: { eventDate: "asc" } }, { boutOrder: "desc" }],
    select: {
      id: true,
      weightClass: true,
      titleBout: true,
      boutOrder: true,
      redCornerFighterId: true,
      blueCornerFighterId: true,
      redCornerFighter: { select: { fullName: true } },
      blueCornerFighter: { select: { fullName: true } },
      winnerFighterId: true,
      method: true,
      resultRound: true,
      resultTime: true,
      event: { select: { eventDate: true } },
      fighterStats: { select: LINE_SELECT },
    },
  });
  return rows.map((b) => {
    const red = b.fighterStats.find((s) => s.fighterId === b.redCornerFighterId);
    const blue = b.fighterStats.find((s) => s.fighterId === b.blueCornerFighterId);
    return {
      id: b.id,
      date: b.event.eventDate,
      weightClass: b.weightClass,
      red: b.redCornerFighterId,
      blue: b.blueCornerFighterId,
      redName: b.redCornerFighter.fullName,
      blueName: b.blueCornerFighter.fullName,
      winner: b.winnerFighterId,
      method: b.method,
      round: b.resultRound,
      time: b.resultTime,
      scheduledRounds: b.titleBout || b.boutOrder === 1 || (b.resultRound ?? 0) >= 4 ? 5 : 3,
      redLine: red ? toLogLine(red) : null,
      blueLine: blue ? toLogLine(blue) : null,
    };
  });
}

/** The bout from one fighter's side. */
export function logFor(b: UfcBoutForLogs, fighterId: string): UfcFightLog {
  const red = b.red === fighterId;
  const nc = b.winner === null && /no contest|overturned|could not continue/i.test(b.method ?? "");
  return {
    date: b.date.toISOString().slice(0, 10),
    opponent: red ? b.blueName : b.redName,
    opponentId: red ? b.blue : b.red,
    result: b.winner === fighterId ? "W" : b.winner ? "L" : nc ? "NC" : "D",
    method: b.method,
    round: b.round,
    time: b.time,
    seconds: fightSeconds(b.round, b.time) ?? 0,
    scheduledRounds: b.scheduledRounds,
    weightClass: b.weightClass,
    mine: red ? b.redLine : b.blueLine,
    theirs: red ? b.blueLine : b.redLine,
  };
}

interface Totals {
  min: number;
  sig: number;
  td: number;
  kd: number;
  fights: number;
  fin: number;
}

/** Each division's per-minute averages and finish rate from its totals; a thin division leans on the whole league. */
function priorsFromTotals(byDivision: Map<string, Totals>): Map<string, DivisionPrior> {
  const all: Totals = { min: 0, sig: 0, td: 0, kd: 0, fights: 0, fin: 0 };
  for (const t of byDivision.values()) for (const k of Object.keys(all) as (keyof Totals)[]) all[k] += t[k];
  const out = new Map<string, DivisionPrior>();
  for (const [k, a] of [...byDivision, ["all", all] as const]) {
    const w = Math.min(1, a.min / 2000);
    const per = (x: number, gx: number) => w * (a.min > 0 ? x / a.min : 0) + (1 - w) * (all.min > 0 ? gx / all.min : 0);
    out.set(k, { sig: per(a.sig, all.sig), td: per(a.td, all.td), kd: per(a.kd, all.kd), finish: a.fights >= 30 ? a.fin / a.fights : all.fights ? all.fin / all.fights : 0.5 });
  }
  return out;
}

/** Per-minute averages (per fighter) and finish rate for each division, over the bouts given. */
export function divisionPriors(bouts: UfcBoutForLogs[]): Map<string, DivisionPrior> {
  const acc = new Map<string, Totals>();
  for (const b of bouts) {
    const key = divisionKey(b.weightClass);
    const a = acc.get(key) ?? { min: 0, sig: 0, td: 0, kd: 0, fights: 0, fin: 0 };
    const sec = fightSeconds(b.round, b.time) ?? 0;
    if (b.redLine && b.blueLine && sec > 0) {
      a.min += (2 * sec) / 60;
      a.sig += b.redLine.sig + b.blueLine.sig;
      a.td += b.redLine.td + b.blueLine.td;
      a.kd += b.redLine.kd + b.blueLine.kd;
    }
    if (b.method) {
      a.fights++;
      if (!/decision/i.test(b.method)) a.fin++;
    }
    acc.set(key, a);
  }
  return priorsFromTotals(acc);
}

/** The same priors from one aggregate query over bouts since `since` (the live pages). */
export async function divisionPriorsSince(since: Date): Promise<Map<string, DivisionPrior>> {
  const rows = await prisma.$queryRaw<{ weightClass: string; sec: number; sig: number; td: number; kd: number; fights: number; fin: number }[]>`
    SELECT b."weightClass",
      sum(CASE WHEN s.n = 2 AND b."resultTime" ~ '^[0-9]+:[0-9]+$' THEN ((b."resultRound" - 1) * 300 + split_part(b."resultTime", ':', 1)::int * 60 + split_part(b."resultTime", ':', 2)::int) * 2 ELSE 0 END)::float AS sec,
      sum(CASE WHEN s.n = 2 THEN s.sig ELSE 0 END)::float AS sig, sum(CASE WHEN s.n = 2 THEN s.td ELSE 0 END)::float AS td, sum(CASE WHEN s.n = 2 THEN s.kd ELSE 0 END)::float AS kd,
      count(b.method)::float AS fights, count(*) FILTER (WHERE b.method IS NOT NULL AND b.method !~* 'decision')::float AS fin
    FROM "UfcBout" b
    JOIN "UfcEvent" e ON e.id = b."eventId"
    LEFT JOIN (SELECT "boutId", count(*) AS n, sum("significantStrikesLanded") AS sig, sum("takedownsLanded") AS td, sum(knockdowns) AS kd FROM "UfcBoutFighterStats" GROUP BY "boutId") s ON s."boutId" = b.id
    WHERE b.status = 'completed' AND e."eventDate" >= ${since} AND b."resultRound" IS NOT NULL
    GROUP BY b."weightClass"`;
  const acc = new Map<string, Totals>();
  for (const r of rows) {
    const key = divisionKey(r.weightClass);
    const a = acc.get(key) ?? { min: 0, sig: 0, td: 0, kd: 0, fights: 0, fin: 0 };
    a.min += r.sec / 60;
    a.sig += r.sig;
    a.td += r.td;
    a.kd += r.kd;
    a.fights += r.fights;
    a.fin += r.fin;
    acc.set(key, a);
  }
  return priorsFromTotals(acc);
}

export function priorFor(priors: Map<string, DivisionPrior>, weightClass: string): DivisionPrior {
  return priors.get(divisionKey(weightClass)) ?? priors.get("all") ?? { sig: 3.6, td: 0.09, kd: 0.017, finish: 0.5 };
}
