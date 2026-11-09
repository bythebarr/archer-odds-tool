/**
 * The cautious read (canonical CAUTIOUS READ — see ./canonical): how a prop's
 * recent hit record adjusts ARCHR Chance for RANKING. A ranking signal, never
 * a headline probability. Pure.
 *
 * Two implementations live here, side by side, so they can be graded against
 * each other (lib/propModel/cautiousGrade, scripts/backtest-cautious-edge):
 *
 *   LEGACY (min veto) — min(ARCHR Chance, Wilson 1-SE floor of the record).
 *     Whichever is lower wins, always. Biased downward by construction, and a
 *     raw L10 record vetoes a model fitted on thousands of games.
 *
 *   EVIDENCE (Beta posterior) — the record UPDATES ARCHR Chance instead of
 *     vetoing it. ARCHR Chance is the prior mean, worth EVIDENCE_PRIOR_GAMES
 *     pseudo-games; the record's hits and games are the data:
 *
 *         read = (hits + K·p) / (games + K),   K = EVIDENCE_PRIOR_GAMES
 *
 *     so the record's pull is games / (games + K): 3 games move it 13% of
 *     the way toward the record, 10 games 33%, 20 games 50%. It can move the
 *     read up as well as down: no built-in downward bias.
 *
 *     And the record isn't context-blind where the data exists (NBA): each
 *     past game counts by how much its minutes and role resembled tonight's
 *     projected minutes and role (lib/nba/minutes), so a bench stint that no
 *     longer describes the player barely counts after a promotion: a stale
 *     record can't cap a rising model.
 *
 * The +50% trust cap on the relative edge (lib/builder/conservative) is a
 * data-error guard for both and is unchanged.
 */
import { conservativeProb } from "@/lib/builder/conservative";
import type { Rate } from "@/lib/builder/types";

/** Fewer record games than this and a record alone (no ARCHR Chance) makes no read: the legacy rule, kept. */
const LEGACY_MIN_GAMES = 3;

/**
 * Pseudo-games ARCHR Chance is worth as the prior. Chosen so a 3-game record
 * barely moves the read and a 20-game record moves it halfway: the record is
 * real evidence about this player at this line, the blend is a model fitted on
 * thousands of games. Not fitted yet: scripts/backtest-cautious-edge prints a
 * sweep around it for review; it is never refit automatically.
 */
export const EVIDENCE_PRIOR_GAMES = 20;

/**
 * LEGACY: min(ARCHR Chance, Wilson floor of the record); either alone where only
 * one exists. The one implementation is lib/builder/conservative's
 * conservativeProb, unchanged: this is the fallback the mode flag keeps.
 */
export const legacyCautiousChance: (archr: number | null, rate: Rate) => number | null = conservativeProb;

/**
 * EVIDENCE: the record as a Beta update on ARCHR Chance. `rate` may carry
 * fractional (role-weighted) hits and games. With no ARCHR Chance the record
 * stands alone, read with a uniform prior (Laplace), so a 3-for-3 isn't 100%.
 */
export function evidenceCautiousChance(archr: number | null, rate: Rate, priorGames: number = EVIDENCE_PRIOR_GAMES): number | null {
  const [h, n] = rate;
  if (archr === null) return n >= LEGACY_MIN_GAMES ? (h + 1) / (n + 2) : null;
  if (!(n > 0)) return archr;
  return (h + priorGames * archr) / (n + priorGames);
}

/** One past game for the role-weighted record: its stat value (null = no box score), and his minutes and role that night where known. */
export interface RecordGame {
  value: number | null;
  minutes?: number;
  starter?: boolean;
}

/** Tonight's expected role: projected minutes (if he plays), and whether he starts (null = unknown). */
export interface TonightRole {
  minutes: number;
  starter: boolean | null;
}

/** A game whose role differs from tonight's (starter vs bench) counts this much more weakly, on top of the minutes match. */
const ROLE_MISMATCH = 0.5;

/**
 * How much one past game says about tonight: a Gaussian on the gap between its
 * minutes and tonight's projected minutes (width the larger of 4 minutes and
 * 20% of tonight's), halved again when he started that night and won't
 * tonight, or the reverse. 1 when either side's minutes are unknown: no
 * context, no reweighting.
 */
export function roleWeight(game: RecordGame, tonight: TonightRole | null): number {
  if (!tonight || game.minutes === undefined || !(tonight.minutes > 0)) return 1;
  const width = Math.max(4, 0.2 * tonight.minutes);
  const gap = (game.minutes - tonight.minutes) / width;
  const minutesMatch = Math.exp(-0.5 * gap * gap);
  const roleMatch = tonight.starter !== null && game.starter !== undefined && game.starter !== tonight.starter ? ROLE_MISMATCH : 1;
  return minutesMatch * roleMatch;
}

/**
 * The record over a window (the latest `window` games with a value, newest
 * first), each game counted by roleWeight: [weighted hits, weighted games].
 * With no tonight role it's the plain count.
 */
export function roleWeightedRecord(
  games: RecordGame[],
  side: "over" | "under" | "yes",
  point: number,
  tonight: TonightRole | null,
  window: number
): Rate {
  const played = games.filter((g): g is RecordGame & { value: number } => g.value !== null).slice(0, window);
  let hits = 0;
  let n = 0;
  for (const g of played) {
    const w = roleWeight(g, tonight);
    n += w;
    if (side === "under" ? g.value < point : g.value > point) hits += w;
  }
  return [hits, n];
}
