/**
 * UFC fighter props and the fighter sheet: every upcoming bout (or one bout),
 * both fighters with their full UFC fight logs, recency-weighted rates shrunk
 * to the weight class, and ARCHR's projection on significant strikes,
 * takedowns and knockdowns (lib/ufc/propModel.ts). Lines and chances are
 * priced in the browser from the projection.
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { divisionPriorsSince, loadUfcBouts, logFor, priorFor, type UfcBoutForLogs } from "@/lib/ufc/fightLogs";
import { UFC_PROP_PARAMS, UFC_PROP_STATS, projectUfcProp, ufcRates, type DivisionPrior, type UfcFightLog, type UfcPropProjection, type UfcPropStat, type UfcRates } from "@/lib/ufc/propModel";
import { identifyMainEventBoutId } from "@/lib/ufc/mainEvent";
import { formatFighterRecord } from "./ufcEvents";

const DAYS_AHEAD = 45;

export interface UfcPropsBout {
  id: string;
  eventTitle: string;
  eventDate: string;
  weightClass: string;
  rounds: number;
  title: boolean;
  completed: boolean;
  red: { name: string; photo: string | null };
  blue: { name: string; photo: string | null };
}

/** How much UFC tape the projection stands on. */
export type UfcSample = "debut" | "thin" | "solid";

export interface UfcPropsFighter {
  /** `${boutId}:${fighterId}` */
  id: string;
  fighterId: string;
  boutId: string;
  name: string;
  nickname: string | null;
  photo: string | null;
  record: string | null;
  ufcRecord: string;
  opponent: string;
  opponentId: string;
  age: number | null;
  heightInches: number | null;
  reachInches: number | null;
  stance: string | null;
  ufcFights: number;
  ufcMinutes: number;
  sample: UfcSample;
  /** How much of each rate is his own tape vs his division's average (0–1). */
  ownWeight: Record<UfcPropStat, number>;
  rates: UfcRates;
  opponentRates: UfcRates;
  prior: DivisionPrior;
  projections: Record<UfcPropStat, UfcPropProjection>;
  /** Significant strikes landed per round, by round number. */
  byRound: { round: number; avg: number; n: number }[];
}

export interface UfcPropsSlate {
  bouts: UfcPropsBout[];
  fighters: Record<string, UfcPropsFighter>;
  /** Most recent first, before the bout. */
  logs: Record<string, UfcFightLog[]>;
}

let priorsMemo: { at: number; value: Map<string, DivisionPrior> } | null = null;
/** Weight-class averages over the last eight years; recomputed every 6 hours. */
async function priors(): Promise<Map<string, DivisionPrior>> {
  if (priorsMemo && Date.now() - priorsMemo.at < 6 * 3_600_000) return priorsMemo.value;
  priorsMemo = { at: Date.now(), value: await divisionPriorsSince(new Date(Date.now() - 8 * 365 * 86_400_000)) };
  return priorsMemo.value;
}

const SAMPLE_MINUTES = { thin: 30 };
const record = (logs: UfcFightLog[]) => {
  const w = logs.filter((l) => l.result === "W").length;
  const l = logs.filter((l) => l.result === "L").length;
  const d = logs.filter((l) => l.result === "D").length;
  return `${w}-${l}${d ? `-${d}` : ""}`;
};

export const getUfcPropsSlate = cache(async (opts: { boutId?: string } = {}): Promise<UfcPropsSlate> => {
  const now = new Date();
  const rows = await prisma.ufcBout.findMany({
    where: opts.boutId
      ? { id: opts.boutId }
      : { status: { notIn: ["completed", "cancelled"] }, event: { eventDate: { gte: new Date(now.getTime() - 86_400_000), lte: new Date(now.getTime() + DAYS_AHEAD * 86_400_000) } } },
    orderBy: [{ event: { eventDate: "asc" } }, { boutOrder: "asc" }],
    take: 40,
    include: {
      event: { select: { title: true, eventDate: true, bouts: { select: { id: true, boutOrder: true, redCornerFighter: { select: { fullName: true, nickname: true } }, blueCornerFighter: { select: { fullName: true, nickname: true } } } } } },
      redCornerFighter: true,
      blueCornerFighter: true,
    },
  });
  const ids = [...new Set(rows.flatMap((b) => [b.redCornerFighterId, b.blueCornerFighterId]))];
  const [history, pri, roundRows] = await Promise.all([
    ids.length ? loadUfcBouts(ids) : Promise.resolve([] as UfcBoutForLogs[]),
    priors(),
    ids.length
      ? prisma.ufcBoutRoundStats.groupBy({ by: ["fighterId", "round"], where: { fighterId: { in: ids } }, _avg: { significantStrikesLanded: true }, _count: { _all: true } })
      : Promise.resolve([]),
  ]);
  const allLogs = new Map<string, UfcFightLog[]>();
  for (const b of history) for (const id of [b.red, b.blue]) if (ids.includes(id)) allLogs.set(id, [logFor(b, id), ...(allLogs.get(id) ?? [])]);

  const bouts: UfcPropsBout[] = [];
  const fighters: Record<string, UfcPropsFighter> = {};
  const logs: Record<string, UfcFightLog[]> = {};
  for (const b of rows) {
    const main = identifyMainEventBoutId(
      b.event.bouts.map((x) => ({ id: x.id, boutOrder: x.boutOrder, redName: x.redCornerFighter.fullName, blueName: x.blueCornerFighter.fullName, redNickname: x.redCornerFighter.nickname, blueNickname: x.blueCornerFighter.nickname })),
      b.event.title,
    );
    const rounds = b.titleBout || main === b.id || (b.resultRound ?? 0) >= 4 ? 5 : 3;
    const date = b.event.eventDate;
    const completed = b.status === "completed";
    bouts.push({
      id: b.id,
      eventTitle: b.event.title,
      eventDate: date.toISOString(),
      weightClass: b.weightClass.replace(/\s+Bout$/i, ""),
      rounds,
      title: b.titleBout,
      completed,
      red: { name: b.redCornerFighter.fullName, photo: b.redCornerFighter.imageUrl },
      blue: { name: b.blueCornerFighter.fullName, photo: b.blueCornerFighter.imageUrl },
    });
    const prior = priorFor(pri, b.weightClass);
    const before = (id: string) => (allLogs.get(id) ?? []).filter((l) => new Date(l.date) < date);
    for (const [me, them] of [
      [b.redCornerFighter, b.blueCornerFighter],
      [b.blueCornerFighter, b.redCornerFighter],
    ] as const) {
      const mine = before(me.id);
      const theirs = before(them.id);
      const rates = ufcRates(mine, date, prior);
      const opponentRates = ufcRates(theirs, date, prior);
      const projections = Object.fromEntries(UFC_PROP_STATS.map((s) => [s.key, projectUfcProp(s.key, rates, opponentRates, prior, rounds)])) as Record<UfcPropStat, UfcPropProjection>;
      const minutes = mine.reduce((a, l) => a + l.seconds / 60, 0);
      const id = `${b.id}:${me.id}`;
      const dob = me.birthDate;
      fighters[id] = {
        id,
        fighterId: me.id,
        boutId: b.id,
        name: me.fullName,
        nickname: me.nickname,
        photo: me.imageUrl,
        record: formatFighterRecord(me.recordWins, me.recordLosses, me.recordDraws),
        ufcRecord: record(mine),
        opponent: them.fullName,
        opponentId: them.id,
        age: dob ? (date.getTime() - dob.getTime()) / (365.25 * 86_400_000) : null,
        heightInches: me.heightInches,
        reachInches: me.reachInches,
        stance: me.stance,
        ufcFights: mine.length,
        ufcMinutes: minutes,
        sample: mine.length === 0 ? "debut" : minutes < SAMPLE_MINUTES.thin || mine.length < 3 ? "thin" : "solid",
        ownWeight: Object.fromEntries(UFC_PROP_STATS.map((s) => [s.key, rates.minutes / (rates.minutes + UFC_PROP_PARAMS.priorMinutes[s.key])])) as Record<UfcPropStat, number>,
        rates,
        opponentRates,
        prior,
        projections,
        byRound: roundRows
          .filter((r) => r.fighterId === me.id)
          .map((r) => ({ round: r.round, avg: r._avg.significantStrikesLanded ?? 0, n: r._count._all }))
          .sort((x, y) => x.round - y.round),
      };
      logs[me.id] ??= mine;
    }
  }
  return { bouts, fighters, logs };
});
