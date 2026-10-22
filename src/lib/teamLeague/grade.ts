import { prisma } from "@/lib/prisma";
import type { MarketType } from "@/generated/prisma/client";
import type { Play, PlayGrade } from "@/lib/engine/types";

/**
 * Grade one tracked team-league play against its settled game.
 *
 * Settlement lives in GameOutcome, written by the shared `gradeGame` off ESPN's
 * free scoreboard (see results.ts) — the same table and the same grader MLB
 * uses, so h2h/spreads/totals all settle without league-specific math. Not
 * final, or final but not yet graded → "pending"; a later pass settles it, and a
 * fabricated loss is never returned.
 */
export async function gradeTeamLeaguePlay(play: Play): Promise<PlayGrade> {
  const game = await prisma.game.findUnique({
    where: { id: play.eventRef },
    select: { status: true, homeTeamId: true, awayTeamId: true },
  });
  if (!game || game.status !== "final") return "pending";

  // Totals are graded once per game from the Over's perspective and stored
  // against both teams, so either team's row answers an over/under ask; the
  // home row is picked arbitrarily for that market.
  const teamId =
    play.selection.kind === "total"
      ? game.homeTeamId
      : play.selection.side === "home"
        ? game.homeTeamId
        : game.awayTeamId;
  if (!teamId) return "void";

  const outcome = await prisma.gameOutcome.findUnique({
    where: {
      gameId_teamId_marketType: {
        gameId: play.eventRef,
        teamId,
        marketType: play.selection.market as MarketType,
      },
    },
  });
  if (!outcome) return "pending"; // not graded yet — leave it for a later pass

  // A totals play stored from the Over's perspective must be flipped for Unders.
  if (play.selection.kind === "total" && play.selection.side === "under") {
    if (outcome.result === "hit") return "miss";
    if (outcome.result === "miss") return "hit";
    return "push";
  }
  return outcome.result as PlayGrade; // hit | miss | push
}
