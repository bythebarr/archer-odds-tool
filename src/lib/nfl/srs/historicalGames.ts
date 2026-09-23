/**
 * Adapts `src/lib/nfl/games.ts`'s nflverse feed into `NflCompletedGame[]` for the
 * SRS rating solver. Two exclusions the CFB equivalent doesn't need to think about
 * (ESPN's scoreboard is regular-season-scoped by the `groups=80` query already):
 *
 * - Preseason games are excluded by only accepting `gameType === "REG"` — same
 *   spirit as MLB's `purgePreseasonGames`, a preseason score is not a meaningful
 *   opponent-adjusted signal.
 * - Playoff games ("POST", or the older "WC"/"DIV"/"CON"/"SB" codes) are excluded
 *   from ratings in v1, mirroring CFB v0's own bowl-game exclusion (elimination-game
 *   incentives and rest patterns differ from the regular season) — not a permanent
 *   ban, just today's scope.
 */
import type { NflGame } from "../games";
import type { NflCompletedGame } from "./types";

/** Regular-season game-type code across every nflverse file era. */
const REGULAR_SEASON_TYPE = "REG";

/** Reduces the nflverse feed to completed, regular-season games, mapped into the shape the rating solver consumes. */
export function toCompletedGames(games: readonly NflGame[]): NflCompletedGame[] {
  const out: NflCompletedGame[] = [];
  for (const g of games) {
    if (g.gameType !== REGULAR_SEASON_TYPE) continue;
    if (g.homeScore === null || g.awayScore === null) continue;
    out.push({
      gameId: g.gameId,
      startUtc: g.date,
      neutralSite: g.neutralSite,
      homeTeamId: g.home,
      awayTeamId: g.away,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
    });
  }
  return out;
}
