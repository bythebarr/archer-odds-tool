-- CheckConstraint: widen the team-pair branch to also cover NFL.
--
-- NFL reuses the same shape MLB and soccer do (homeTeamId/awayTeamId set,
-- player fields null), so this is the same one-word widening the soccer
-- migration made. Without it every NFL insert fails the constraint at runtime
-- — a violation the type system cannot catch, since `sport` is a valid enum
-- value the moment it's added to the schema.
ALTER TABLE "Game" DROP CONSTRAINT "game_sport_competitor_check";

ALTER TABLE "Game" ADD CONSTRAINT "game_sport_competitor_check" CHECK (
  (sport IN ('mlb', 'soccer', 'nfl') AND "homeTeamId" IS NOT NULL AND "awayTeamId" IS NOT NULL AND "homePlayerId" IS NULL AND "awayPlayerId" IS NULL)
  OR
  (sport = 'tennis' AND "homePlayerId" IS NOT NULL AND "awayPlayerId" IS NOT NULL AND "homeTeamId" IS NULL AND "awayTeamId" IS NULL)
);
