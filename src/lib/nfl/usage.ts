/**
 * An NFL player's role and efficiency, from his box scores and his team's:
 * the share of the team's targets and carries he gets (the number props are
 * really priced on), and what he does with them. Pure; logs most recent first.
 */
import type { NflLogPoint } from "./propsMath";

/** The team's targets, rush attempts and pass attempts in one of his games (queries/nflProps.ts). */
export type TeamVolume = [number, number, number];

export interface UsageGame {
  date: string;
  opponent: string;
  isHome: boolean;
  targetShare: number | null;
  carryShare: number | null;
  teamPassAttempts: number;
}

export interface UsageWindow {
  games: number;
  targetShare: number | null;
  carryShare: number | null;
  targetsPerGame: number;
  carriesPerGame: number;
  catchRate: number | null;
  yardsPerTarget: number | null;
  yardsPerReception: number | null;
  yardsPerCarry: number | null;
  completionPct: number | null;
  yardsPerAttempt: number | null;
  passTdRate: number | null;
  intRate: number | null;
  touchdownsPerGame: number;
  teamPassAttempts: number;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function usageGames(logs: NflLogPoint[], volume: TeamVolume[]): UsageGame[] {
  return logs.map((l, i) => {
    const [tgt, rush, pass] = volume[i] ?? [0, 0, 0];
    return { date: l.date, opponent: l.opponent, isHome: l.isHome, targetShare: ratio(l.targets, tgt), carryShare: ratio(l.rushAttempts, rush), teamPassAttempts: pass };
  });
}

export function usageWindow(logs: NflLogPoint[], volume: TeamVolume[]): UsageWindow {
  const sum = (f: (l: NflLogPoint) => number) => logs.reduce((a, l) => a + f(l), 0);
  const team = (k: 0 | 1 | 2) => logs.reduce((a, _, i) => a + (volume[i]?.[k] ?? 0), 0);
  const n = logs.length;
  const targets = sum((l) => l.targets);
  const carries = sum((l) => l.rushAttempts);
  const att = sum((l) => l.passAttempts);
  return {
    games: n,
    targetShare: ratio(targets, team(0)),
    carryShare: ratio(carries, team(1)),
    targetsPerGame: n ? targets / n : 0,
    carriesPerGame: n ? carries / n : 0,
    catchRate: ratio(sum((l) => l.receptions), targets),
    yardsPerTarget: ratio(sum((l) => l.recYards), targets),
    yardsPerReception: ratio(sum((l) => l.recYards), sum((l) => l.receptions)),
    yardsPerCarry: ratio(sum((l) => l.rushYards), carries),
    completionPct: ratio(sum((l) => l.passCompletions), att),
    yardsPerAttempt: ratio(sum((l) => l.passYards), att),
    passTdRate: ratio(sum((l) => l.passTds), att),
    intRate: ratio(sum((l) => l.interceptions), att),
    touchdownsPerGame: n ? sum((l) => l.rushTds + l.recTds) / n : 0,
    teamPassAttempts: n ? team(2) / n : 0,
  };
}
