/**
 * The advanced side of an NFL player's games, for the sheet: snap share, how
 * the targets come (air yards, depth, red zone, end zone), what he does with
 * them (EPA, YAC, first downs), and his expected TDs against the real ones.
 * Pure; over whichever games carry the nflverse line (older ones don't).
 */
import type { NflLogPoint } from "./propsMath";
import { expectedTds } from "./projection";

export interface AdvancedWindow {
  /** Games with the advanced line. */
  games: number;
  snapPct: number | null;
  targetShare: number | null;
  airYardsShare: number | null;
  /** Average depth of target (receivers) or of attempt (QBs). */
  adot: number | null;
  /** 1.5 × target share + 0.7 × air-yards share. */
  wopr: number | null;
  yacPerCatch: number | null;
  epaPerTarget: number | null;
  firstDownsPerTarget: number | null;
  rzTargetsPerGame: number | null;
  ezTargetsPerGame: number | null;
  deepTargetsPerGame: number | null;
  rzCarriesPerGame: number | null;
  glCarriesPerGame: number | null;
  epaPerCarry: number | null;
  firstDownsPerCarry: number | null;
  xTdPerGame: number | null;
  tdPerGame: number | null;
  dropbacksPerGame: number | null;
  epaPerDropback: number | null;
  cpoe: number | null;
  deepAttemptRate: number | null;
  sackRate: number | null;
  scrambleRate: number | null;
  rzAttemptsPerGame: number | null;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function advancedWindow(logs: NflLogPoint[]): AdvancedWindow {
  const g = logs.filter((l) => l.rzTargets != null);
  const n = g.length;
  const sum = (f: (l: NflLogPoint) => number | null | undefined) => g.reduce((a, l) => a + (f(l) ?? 0), 0);
  const avg = (f: (l: NflLogPoint) => number | null | undefined) => {
    const v = g.map(f).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const per = (f: (l: NflLogPoint) => number | null | undefined) => (n ? sum(f) / n : null);
  const targets = sum((l) => l.targets);
  const carries = sum((l) => l.rushAttempts);
  const dropbacks = sum((l) => l.dropbacks);
  const atts = sum((l) => l.passAttempts);
  const ts = avg((l) => l.targetShare);
  const ays = avg((l) => l.airYardsShare);
  // CPOE weighted by attempts, over games that have it.
  const cp = g.filter((l) => l.cpoe != null && l.passAttempts > 0);
  return {
    games: n,
    snapPct: avg((l) => l.snapPct),
    targetShare: ts,
    airYardsShare: ays,
    adot: atts >= targets && atts > 0 ? ratio(sum((l) => l.passAirYards), atts) : ratio(sum((l) => l.airYards), targets),
    wopr: ts !== null && ays !== null ? 1.5 * ts + 0.7 * ays : null,
    yacPerCatch: ratio(sum((l) => l.yac), sum((l) => l.receptions)),
    epaPerTarget: ratio(sum((l) => l.recEpa), targets),
    firstDownsPerTarget: ratio(sum((l) => l.recFirstDowns), targets),
    rzTargetsPerGame: per((l) => l.rzTargets),
    ezTargetsPerGame: per((l) => l.ezTargets),
    deepTargetsPerGame: per((l) => l.deepTargets),
    rzCarriesPerGame: per((l) => l.rzCarries),
    glCarriesPerGame: per((l) => l.glCarries),
    epaPerCarry: ratio(sum((l) => l.rushEpa), carries),
    firstDownsPerCarry: ratio(sum((l) => l.rushFirstDowns), carries),
    xTdPerGame: per((l) => expectedTds(l)),
    tdPerGame: per((l) => l.rushTds + l.recTds),
    dropbacksPerGame: per((l) => l.dropbacks),
    epaPerDropback: ratio(sum((l) => l.passEpa), dropbacks),
    cpoe: cp.length ? cp.reduce((a, l) => a + l.cpoe! * l.passAttempts, 0) / cp.reduce((a, l) => a + l.passAttempts, 0) : null,
    deepAttemptRate: ratio(sum((l) => l.deepAttempts), atts),
    sackRate: ratio(sum((l) => l.sacksTaken), dropbacks),
    scrambleRate: ratio(sum((l) => l.scrambles), dropbacks),
    rzAttemptsPerGame: per((l) => l.rzPassAttempts),
  };
}
