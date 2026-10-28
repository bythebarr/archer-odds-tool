/**
 * Each team's shots and shots on target per match, for and against, from the
 * player box scores — the matchup soccer player props are scaled by
 * (propModel.ts › SoccerMatchContext). Pure.
 */
import type { SoccerMatchContext } from "./propModel";

export interface ShotRow {
  team: string;
  opponent: string;
  /** YYYY-MM-DD */
  date: string;
  shots: number;
  shotsOnTarget: number;
}

export interface TeamMatch {
  opponent: string;
  isHome?: boolean;
  shots: number;
  sot: number;
}

export interface ShotTotals {
  /** `${team}|${date}` → that team's totals in that match. */
  matches: Map<string, TeamMatch & { isHome: boolean }>;
  /** Team → its match dates, newest first. */
  dates: Map<string, string[]>;
  leagueShots: number;
  leagueSot: number;
}

export function teamShotTotals(rows: (ShotRow & { isHome?: boolean })[]): ShotTotals {
  const matches = new Map<string, TeamMatch & { isHome: boolean }>();
  for (const r of rows) {
    const k = `${r.team}|${r.date}`;
    const m = matches.get(k) ?? { opponent: r.opponent, isHome: r.isHome ?? false, shots: 0, sot: 0 };
    m.shots += r.shots;
    m.sot += r.shotsOnTarget;
    if (r.isHome !== undefined) m.isHome = r.isHome;
    matches.set(k, m);
  }
  const dates = new Map<string, string[]>();
  let shots = 0;
  let sot = 0;
  for (const [k, m] of matches) {
    const [team, date] = k.split("|") as [string, string];
    (dates.get(team) ?? dates.set(team, []).get(team)!).push(date);
    shots += m.shots;
    sot += m.sot;
  }
  for (const d of dates.values()) d.sort((a, b) => (a < b ? 1 : -1));
  return { matches, dates, leagueShots: matches.size ? shots / matches.size : 12, leagueSot: matches.size ? sot / matches.size : 4 };
}

/** Per-match average over the team's last `n` matches before `date`: what it took, and what its opponents took against it. */
export function teamShotForm(t: ShotTotals, team: string, before: string, n = 10): { shotsFor: number; sotFor: number; shotsAgainst: number; sotAgainst: number; matches: number } | null {
  const dates = (t.dates.get(team) ?? []).filter((d) => d < before).slice(0, n);
  let sf = 0;
  let of = 0;
  let sa = 0;
  let oa = 0;
  let count = 0;
  for (const d of dates) {
    const m = t.matches.get(`${team}|${d}`)!;
    const opp = t.matches.get(`${m.opponent}|${d}`);
    if (!opp) continue;
    sf += m.shots;
    of += m.sot;
    sa += opp.shots;
    oa += opp.sot;
    count++;
  }
  return count >= 3 ? { shotsFor: sf / count, sotFor: of / count, shotsAgainst: sa / count, sotAgainst: oa / count, matches: count } : null;
}

export function shotContext(t: ShotTotals, opponent: string, before: string, isHome: boolean): SoccerMatchContext {
  const opp = teamShotForm(t, opponent, before);
  return { isHome, oppShotsAllowed: opp?.shotsAgainst ?? null, oppSotFor: opp?.sotFor ?? null, leagueShots: t.leagueShots, leagueSot: t.leagueSot };
}
