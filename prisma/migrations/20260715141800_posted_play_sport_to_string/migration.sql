-- Retire the `Sport` enum from the ledger path (sport-engine Phase 3): PostedPlay.sport
-- becomes a plain registry string key so a new sport flows through the ledger/grader
-- with no enum migration. Grading dispatches on it via getAdapter(sport). The `Sport`
-- enum itself is untouched — it still types `Game.sport`.
--
-- In-place cast, NOT drop-and-recreate: existing enum values ('mlb','ufc',...) cast
-- cleanly to text, so live graded rows keep their sport. (Prisma's diff defaults to a
-- destructive DROP/ADD here because it doesn't emit the enum→text USING cast itself.)
ALTER TABLE "PostedPlay" ALTER COLUMN "sport" SET DATA TYPE TEXT USING "sport"::text;
