-- The NHL joins the team-pair branch of the Game competitor CHECK: a game is
-- either two teams (mlb, soccer, nfl, nba, nhl) or two players (tennis).
-- Widens 20261022120100_nba_team_pair_constraint, which widened
-- 20261014214500_game_sport_competitor_check. The CHECK still applies only
-- where no player side is set at all, so the UFC fighter-vs-fighter rows
-- (both competitor FKs NULL) stay untouched.
ALTER TABLE "Game" DROP CONSTRAINT IF EXISTS "game_sport_competitor_check";
ALTER TABLE "Game" ADD CONSTRAINT "game_sport_competitor_check" CHECK (
  homePlayerId IS NULL AND awayPlayerId IS NULL AND (
    (sport IN ('mlb'::"Sport", 'soccer'::"Sport", 'nfl'::"Sport", 'nba'::"Sport", 'nhl'::"Sport")
      AND homeTeamId IS NOT NULL AND awayTeamId IS NOT NULL
      AND homePlayerId IS NULL AND awayPlayerId IS NULL)
    OR
    (sport = 'tennis'::"Sport"
      AND homeTeamId IS NULL AND awayTeamId IS NULL
      AND homePlayerId IS NOT NULL AND awayPlayerId IS NOT NULL)
    OR homeTeamId IS NULL
  )
);
