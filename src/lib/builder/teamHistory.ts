/**
 * How a team bet would have done in the teams' recent games: a moneyline
 * (did they win), a spread at tonight's number (did they cover it), a total at
 * tonight's number (did their games go over or under it), a draw (did their
 * games end level). Feeds the builder's hit-rate windows for game lines in any
 * sport. Pure.
 */
import type { Outcome } from "./types";

export interface PastGame {
  /** ISO start, for ordering (newest first is assumed by callers' input). */
  startsAt: string;
  season: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

export type TeamBet =
  | { kind: "ml"; team: string }
  | { kind: "draw"; home: string; away: string }
  /** `point` is the team's own handicap (−3.5 favored). */
  | { kind: "spread"; team: string; point: number }
  | { kind: "total"; side: "over" | "under"; home: string; away: string; point: number };

const played = (g: PastGame, team: string) => g.home === team || g.away === team;

/** Either team's games, newest first, each game once. */
function eitherTeam(history: PastGame[], a: string, b: string): PastGame[] {
  return history.filter((g) => played(g, a) || played(g, b));
}

/** The bet's outcome in each of the relevant past games, newest first (history must be newest first). */
export function teamBetOutcomes(history: PastGame[], bet: TeamBet): Outcome[] {
  switch (bet.kind) {
    case "ml":
    case "spread":
      return history
        .filter((g) => played(g, bet.team))
        .map((g) => {
          const margin = g.home === bet.team ? g.homeScore - g.awayScore : g.awayScore - g.homeScore;
          return { season: g.season, hit: bet.kind === "ml" ? margin > 0 : margin + bet.point > 0 };
        });
    case "draw":
      return eitherTeam(history, bet.home, bet.away).map((g) => ({ season: g.season, hit: g.homeScore === g.awayScore }));
    case "total":
      return eitherTeam(history, bet.home, bet.away).map((g) => {
        const total = g.homeScore + g.awayScore;
        return { season: g.season, hit: bet.side === "over" ? total > bet.point : total < bet.point };
      });
  }
}
