/**
 * Each NFL team's offense and defense this season from the play-by-play
 * (NflTeamGame): how often it throws in neutral situations and how that
 * compares with what's expected there (PROE), its pace, red-zone trips, and EPA
 * per play — and the same against each defense, with league ranks. What the
 * props sheet frames a player's opportunity with.
 */
import { prisma } from "@/lib/prisma";

export interface NflSide {
  games: number;
  playsPerGame: number;
  dropbacksPerGame: number;
  /** Share of neutral-situation plays that were dropbacks. */
  neutralPassRate: number | null;
  /** Neutral pass rate minus expected (nflverse's xpass), in points. */
  proe: number | null;
  rzPlaysPerGame: number;
  epaPerPlay: number | null;
  passEpaPerDropback: number | null;
  rushEpaPerRush: number | null;
}

export interface NflTeamContext {
  offense: NflSide;
  /** What opponents did against this defense. */
  defense: NflSide;
  /** 1 = most / best for the offense (most plays, highest EPA; for defense, 1 = allows the most). */
  ranks: { neutralPassRate: number; proe: number; plays: number; epa: number; passEpa: number; rushEpa: number; passEpaAllowed: number; rushEpaAllowed: number; epaAllowed: number };
}

type Row = { plays: number; dropbacks: number; rushAttempts: number; neutralPlays: number; neutralPasses: number; neutralXpass: number; rzPlays: number; epa: number; passEpa: number; rushEpa: number };

function side(rows: Row[]): NflSide {
  const n = rows.length;
  const s = (k: keyof Row) => rows.reduce((a, r) => a + r[k], 0);
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
  const np = s("neutralPlays");
  return {
    games: n,
    playsPerGame: n ? s("plays") / n : 0,
    dropbacksPerGame: n ? s("dropbacks") / n : 0,
    neutralPassRate: ratio(s("neutralPasses"), np),
    proe: np > 0 ? ((s("neutralPasses") - s("neutralXpass")) / np) * 100 : null,
    rzPlaysPerGame: n ? s("rzPlays") / n : 0,
    epaPerPlay: ratio(s("epa"), s("plays")),
    passEpaPerDropback: ratio(s("passEpa"), s("dropbacks")),
    rushEpaPerRush: ratio(s("rushEpa"), s("rushAttempts")),
  };
}

/** Rank 1 = the largest value. */
function rankBy<T>(items: [string, T][], v: (t: T) => number | null): Map<string, number> {
  const sorted = [...items].sort((a, b) => (v(b[1]) ?? -Infinity) - (v(a[1]) ?? -Infinity));
  return new Map(sorted.map(([k], i) => [k, i + 1]));
}

export async function getNflTeamContext(season: number): Promise<Record<string, NflTeamContext>> {
  const rows = await prisma.nflTeamGame.findMany({
    where: { season },
    select: {
      gameId: true,
      teamId: true,
      plays: true,
      dropbacks: true,
      rushAttempts: true,
      neutralPlays: true,
      neutralPasses: true,
      neutralXpass: true,
      rzPlays: true,
      epa: true,
      passEpa: true,
      rushEpa: true,
      team: { select: { abbreviation: true } },
    },
  });
  const byGame = new Map<string, typeof rows>();
  for (const r of rows) byGame.set(r.gameId, [...(byGame.get(r.gameId) ?? []), r]);
  const off = new Map<string, Row[]>();
  const def = new Map<string, Row[]>();
  for (const r of rows) {
    const abbr = r.team.abbreviation;
    off.set(abbr, [...(off.get(abbr) ?? []), r]);
    const opp = byGame.get(r.gameId)?.find((x) => x.teamId !== r.teamId);
    if (opp) def.set(opp.team.abbreviation, [...(def.get(opp.team.abbreviation) ?? []), r]);
  }
  const sides: [string, { offense: NflSide; defense: NflSide }][] = [...off.keys()].map((k) => [k, { offense: side(off.get(k)!), defense: side(def.get(k) ?? []) }]);
  const r = {
    neutralPassRate: rankBy(sides, (s) => s.offense.neutralPassRate),
    proe: rankBy(sides, (s) => s.offense.proe),
    plays: rankBy(sides, (s) => s.offense.playsPerGame),
    epa: rankBy(sides, (s) => s.offense.epaPerPlay),
    passEpa: rankBy(sides, (s) => s.offense.passEpaPerDropback),
    rushEpa: rankBy(sides, (s) => s.offense.rushEpaPerRush),
    passEpaAllowed: rankBy(sides, (s) => s.defense.passEpaPerDropback),
    rushEpaAllowed: rankBy(sides, (s) => s.defense.rushEpaPerRush),
    epaAllowed: rankBy(sides, (s) => s.defense.epaPerPlay),
  };
  return Object.fromEntries(
    sides.map(([k, s]) => [
      k,
      {
        ...s,
        ranks: Object.fromEntries(Object.entries(r).map(([name, m]) => [name, m.get(k)!])) as NflTeamContext["ranks"],
      },
    ]),
  );
}
