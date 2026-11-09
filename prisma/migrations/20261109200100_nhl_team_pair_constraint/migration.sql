-- CheckConstraint: widen the team-pair branch to also cover NHL.
--
-- Same one-word widening the NBA migration (20261022120100) made: NHL rows
-- are team-pair Game rows (homeTeamId/awayTeamId set, player fields null).
--
-- CORRECTION (2026-11-09): the first version of this migration failed in
-- production (Prisma P3018, Postgres 42703 "column homeplayerid does not
-- exist") and blocked every Vercel deploy behind P3009. It referenced the
-- competitor columns UNQUOTED, so Postgres folded them to lowercase and
-- could not resolve the camelCase columns; it also restructured the check
-- behind an outer "no player side set" gate that would have rejected every
-- existing tennis row on validation. This version restores the established
-- constraint shape (quoted identifiers, the two proven branches) with the
-- single 'nhl' widening — identical semantics to the constraint production
-- has enforced since 20261022120100, plus NHL.
ALTER TABLE "Game" DROP CONSTRAINT IF EXISTS "game_sport_competitor_check";

ALTER TABLE "Game" ADD CONSTRAINT "game_sport_competitor_check" CHECK (
  (sport IN ('mlb', 'soccer', 'nfl', 'nba', 'nhl') AND "homeTeamId" IS NOT NULL AND "awayTeamId" IS NOT NULL AND "homePlayerId" IS NULL AND "awayPlayerId" IS NULL)
  OR
  (sport = 'tennis' AND "homePlayerId" IS NOT NULL AND "awayPlayerId" IS NOT NULL AND "homeTeamId" IS NULL AND "awayTeamId" IS NULL)
);
