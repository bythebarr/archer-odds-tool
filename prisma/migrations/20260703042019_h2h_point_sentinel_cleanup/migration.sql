-- CurrentOddsLine rows for h2h written before the previous migration have
-- point = NULL; ingestion now writes a 0 sentinel for h2h instead (Postgres
-- NULL never equals NULL, which broke upsert idempotency for the unique
-- constraint added in that migration). Both values normalize to null for
-- display, so a stale NULL row and a fresh 0 row for the same
-- (game, book, side) show up as visual duplicates. Prefer the fresher
-- sentinel row where one already exists, then convert any remaining
-- unconverted NULL rows so future upserts match correctly.

DELETE FROM "CurrentOddsLine" a
USING "CurrentOddsLine" b
WHERE a."marketType" = 'h2h' AND a."point" IS NULL
  AND b."marketType" = 'h2h' AND b."point" = 0
  AND a."gameId" = b."gameId" AND a."bookKey" = b."bookKey" AND a."side" = b."side";

UPDATE "CurrentOddsLine" SET "point" = 0 WHERE "marketType" = 'h2h' AND "point" IS NULL;
