-- CheckConstraint: widen the team-pair branch to also cover NBA.
--
-- Same one-word widening the NFL migration made: NBA rows are team-pair Game
-- rows (homeTeamId/awayTeamId set, player fields null). Without it every NBA
-- insert fails the constraint at runtime — a violation the type system cannot
-- catch, since `sport` is a valid enum value the moment it's in the schema.
ALTER TABLE "Game" DROP CONSTRAINT "game_sport_competitor_check";

ALTER TABLE "Game" ADD CONSTRAINT "game_sport_competitor_check" CHECK (
  (sport IN ('mlb', 'soccer', 'nfl', 'nba') AND "homeTeamId" IS NOT NULL AND "awayTeamId" IS NOT NULL AND "homePlayerId" IS NULL AND "awayPlayerId" IS NULL)
  OR
  (sport = 'tennis' AND "homePlayerId" IS NOT NULL AND "awayPlayerId" IS NOT NULL AND "homeTeamId" IS NULL AND "awayTeamId" IS NULL)
);
