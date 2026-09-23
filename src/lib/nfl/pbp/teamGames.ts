/**
 * Reduces scrimmage plays to one observation per (game, offense) — the unit
 * every as-of team rating in this folder is solved over. Pure; no I/O.
 *
 * "Neutral" plays (the only ones counted) follow the public-analytics
 * convention for measuring team quality rather than game script: pass or rush
 * with a defined EPA, no kneels/spikes/two-point tries, in-game win
 * probability between 10% and 90%, and outside each half's final two minutes.
 */
import type { NflPlay } from "./types";

export interface TeamGameObs {
  gameId: string;
  season: number;
  week: number;
  seasonType: string;
  gameDate: string;
  off: string;
  def: string;
  offIsHome: boolean;
  plays: number;
  epa: number;
  success: number;
  passPlays: number;
  passEpa: number;
  passSuccess: number;
  rushPlays: number;
  rushEpa: number;
  rushSuccess: number;
  dropbacks: number;
  sacks: number;
  earlyDownPlays: number;
  earlyDownPasses: number;
  /** Pass ≥ 20 yards or rush ≥ 10 yards. */
  explosives: number;
}

export const NEUTRAL_WP_MIN = 0.1;
export const NEUTRAL_WP_MAX = 0.9;
export const NEUTRAL_HALF_SECONDS_MIN = 120;

export function isNeutralPlay(p: NflPlay): boolean {
  if (p.epa === null || p.qbKneel || p.qbSpike || p.twoPointAttempt) return false;
  if (p.wp === null || p.wp < NEUTRAL_WP_MIN || p.wp > NEUTRAL_WP_MAX) return false;
  if (p.halfSecondsRemaining !== null && p.halfSecondsRemaining <= NEUTRAL_HALF_SECONDS_MIN) return false;
  return true;
}

export function buildTeamGames(plays: readonly NflPlay[]): TeamGameObs[] {
  const byKey = new Map<string, TeamGameObs>();
  for (const p of plays) {
    if (!isNeutralPlay(p)) continue;
    const key = `${p.gameId}|${p.posteam}`;
    let o = byKey.get(key);
    if (!o) {
      o = {
        gameId: p.gameId,
        season: p.season,
        week: p.week,
        seasonType: p.seasonType,
        gameDate: p.gameDate,
        off: p.posteam,
        def: p.defteam,
        offIsHome: p.posteam === p.homeTeam,
        plays: 0, epa: 0, success: 0,
        passPlays: 0, passEpa: 0, passSuccess: 0,
        rushPlays: 0, rushEpa: 0, rushSuccess: 0,
        dropbacks: 0, sacks: 0, earlyDownPlays: 0, earlyDownPasses: 0, explosives: 0,
      };
      byKey.set(key, o);
    }
    const epa = p.epa!;
    const s = p.success ? 1 : 0;
    o.plays++;
    o.epa += epa;
    o.success += s;
    if (p.pass) {
      o.passPlays++;
      o.passEpa += epa;
      o.passSuccess += s;
    } else {
      o.rushPlays++;
      o.rushEpa += epa;
      o.rushSuccess += s;
    }
    if (p.qbDropback) {
      o.dropbacks++;
      if (p.sack) o.sacks++;
    }
    if (p.down === 1 || p.down === 2) {
      o.earlyDownPlays++;
      if (p.pass) o.earlyDownPasses++;
    }
    const y = p.yardsGained ?? 0;
    if ((p.pass && y >= 20) || (!p.pass && y >= 10)) o.explosives++;
  }
  return [...byKey.values()];
}
