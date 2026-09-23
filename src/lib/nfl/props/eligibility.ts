/**
 * Which players get a projection for which prop family, plus the naive
 * baselines (season average, last-5 average) the model is judged against.
 * Walk-forward like `engine.ts`: `baseline()` reads history strictly before the
 * week being projected; `foldWeek()` adds that week afterwards. Used by both
 * the experiment and the live projector, so the population the model was
 * validated on is exactly the population it's served on.
 *
 * Thresholds are model-independent and pregame: a receiver needs ≥3 targets
 * per game, a rusher ≥5 carries (season-to-date, or last season before his
 * first game this season), a QB ≥15 attempts AND to have been his team's
 * leading passer in its most recent game — so a backup who mopped up once
 * isn't projected as the starter. Everyone needs ≥2 prior games.
 */
import { PROP_MARKETS, actualFor, type PropMarket } from "./model";
import type { PlayerGameKey } from "./engine";
import type { PlayerGame } from "./playerGames";

export type PropFamily = "rec" | "rush" | "pass";

export const MARKET_FAMILY: Record<PropMarket, PropFamily> = {
  receptions: "rec", receivingYards: "rec", rushAttempts: "rush", rushingYards: "rush",
  passAttempts: "pass", completions: "pass", passingYards: "pass",
};

export const ELIGIBILITY = { minPriorGames: 2, minTargetsPerGame: 3, minCarriesPerGame: 5, minAttemptsPerGame: 15 } as const;

export interface Baseline {
  seasonAvg: Record<PropMarket, number> | null;
  l5Avg: Record<PropMarket, number> | null;
  eligible: Record<PropFamily, boolean>;
  priorGames: number;
}

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const avg = (gs: readonly PlayerGame[]) =>
  Object.fromEntries(PROP_MARKETS.map((m) => [m, mean(gs.map((g) => actualFor({ pg: g }, m)))])) as Record<PropMarket, number>;

export class EligibilityTracker {
  private readonly history = new Map<string, PlayerGame[]>();
  private readonly lastLeadPasser = new Map<string, string>();

  baseline(key: PlayerGameKey): Baseline {
    const h = this.history.get(key.playerId) ?? [];
    const thisSeason = h.filter((g) => g.season === key.season);
    const ref = thisSeason.length ? thisSeason : h.filter((g) => g.season === key.season - 1);
    const perGame = (f: (g: PlayerGame) => number) => (ref.length ? mean(ref.map(f)) : 0);
    const enough = h.length >= ELIGIBILITY.minPriorGames;
    return {
      seasonAvg: ref.length ? avg(ref) : null,
      l5Avg: h.length ? avg(h.slice(-5)) : null,
      priorGames: h.length,
      eligible: {
        rec: enough && key.position !== "QB" && perGame((g) => g.targets) >= ELIGIBILITY.minTargetsPerGame,
        rush: enough && perGame((g) => g.carries) >= ELIGIBILITY.minCarriesPerGame,
        pass:
          enough &&
          key.position === "QB" &&
          perGame((g) => g.passAttempts) >= ELIGIBILITY.minAttemptsPerGame &&
          this.lastLeadPasser.get(key.team) === key.playerId,
      },
    };
  }

  /** Most recent game a player appeared in, if any — used to build upcoming candidates. */
  lastGame(playerId: string): PlayerGame | undefined {
    const h = this.history.get(playerId);
    return h?.[h.length - 1];
  }

  players(): IterableIterator<string> {
    return this.history.keys();
  }

  foldWeek(wk: readonly PlayerGame[]): void {
    const lead = new Map<string, PlayerGame>();
    for (const pg of wk) {
      (this.history.get(pg.playerId) ?? this.history.set(pg.playerId, []).get(pg.playerId)!).push(pg);
      const cur = lead.get(pg.team);
      if (!cur || pg.passAttempts > cur.passAttempts) lead.set(pg.team, pg);
    }
    for (const [team, pg] of lead) if (pg.passAttempts > 0) this.lastLeadPasser.set(team, pg.playerId);
  }
}
