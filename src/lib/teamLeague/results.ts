/**
 * Results sync + grading for a team league — the piece that makes a league a
 * tracked, graded sport rather than `signalOnly`.
 *
 * Reads ESPN's free scoreboard (see espnScoreboard.ts), writes final scores onto
 * our Game rows, and hands each newly-final game to the shared `gradeGame`, which
 * settles h2h/spreads/totals off the closing lines we already capture.
 *
 * Matching is on **normalized team names plus ET date**, never on an id and never
 * on a raw UTC clock:
 *
 *  - ids: ParlayAPI's own ids don't agree between its endpoints (12 of 16 for
 *    NFL), so an id join degrades into silent partial loss. ESPN's ids are a
 *    different namespace entirely and would be worse.
 *  - clocks: the odds feed's `commence_time` is 6h early for every game starting
 *    at or after 00:00 UTC, which already corrupted the MLB board once. ET date
 *    is the one key both sources agree on, and it's how the app dates a slate.
 */
import { prisma } from "@/lib/prisma";
import { etDateOf, etDayBoundsUtc } from "@/lib/dateEt";
import { gradeGame } from "@/lib/grading/gradeOutcomes";
import { fetchEspnScoreboard, type EspnTeamResult } from "./espnScoreboard";
import type { TeamLeague } from "./league";

export interface SyncTeamLeagueResultsSummary {
  datesChecked: string[];
  resultsFetched: number;
  gamesFinalized: number;
  gamesGraded: number;
  /** Completed results we couldn't tie to a Game row — named, so drift is debuggable. */
  unmatched: string[];
}

/**
 * How far back to look each run. Wide enough that a missed cron tick or a game
 * finishing after the day rolls over in ET still gets picked up, and cheap
 * because ESPN is free — the reason this isn't the single-day check a credit-
 * metered provider would force.
 */
const LOOKBACK_DAYS = 4;

/** The ET dates to check, today first. */
export function lookbackDatesEt(today: Date, days: number = LOOKBACK_DAYS): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    out.push(etDateOf(new Date(today.getTime() - i * 86_400_000)));
  }
  return out;
}

/** Finds the Game a completed ESPN result refers to — same teams, same ET day. */
export async function findGameForResult(league: TeamLeague, result: EspnTeamResult) {
  const home = league.lookupTeam(result.homeName);
  const away = league.lookupTeam(result.awayName);
  if (!home || !away) return null;

  const { gte, lt } = etDayBoundsUtc(etDateOf(result.startUtc));
  return prisma.game.findFirst({
    where: {
      sport: league.sport,
      scheduledStartUtc: { gte, lt },
      homeTeam: { name: home.name },
      awayTeam: { name: away.name },
    },
  });
}

/**
 * Pulls a league's recent results, finalizes the matching games, and grades
 * them. Idempotent: re-running re-grades to the same values rather than
 * double-counting, because both the score write and `gradeGame` are upserts.
 */
export async function syncAndGradeTeamLeagueResults(
  league: TeamLeague,
  now: Date = new Date()
): Promise<SyncTeamLeagueResultsSummary> {
  const datesChecked = lookbackDatesEt(now);
  const unmatched: string[] = [];
  let resultsFetched = 0;
  let gamesFinalized = 0;
  let gamesGraded = 0;

  for (const dateEt of datesChecked) {
    const results = await fetchEspnScoreboard(league.espnPath, dateEt);
    resultsFetched += results.length;

    for (const result of results) {
      if (!result.completed) continue; // in progress — a live score isn't a final one

      const game = await findGameForResult(league, result);
      if (!game) {
        // Not one of ours is normal (we only store games the odds feed listed),
        // but naming them makes real team-name drift visible instead of silent.
        unmatched.push(`${result.awayName} @ ${result.homeName} (${etDateOf(result.startUtc)})`);
        continue;
      }

      const needsScores =
        game.homeScore !== result.homeScore ||
        game.awayScore !== result.awayScore ||
        game.status !== "final";

      if (needsScores) {
        await prisma.game.update({
          where: { id: game.id },
          data: { homeScore: result.homeScore, awayScore: result.awayScore, status: "final" },
        });
        gamesFinalized++;
      }

      // Grade from the freshly-written values rather than the pre-update row.
      await gradeGame({
        ...game,
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        status: "final",
      });
      gamesGraded++;
    }
  }

  return { datesChecked, resultsFetched, gamesFinalized, gamesGraded, unmatched };
}
