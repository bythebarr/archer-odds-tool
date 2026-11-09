#!/usr/bin/env bash
# One-off unblock for production deploys (see commit 387d85f): the original
# 20261109200100_nhl_team_pair_constraint failed inside a Vercel build, and its
# failed record makes every later `prisma migrate deploy` stop with P3009.
# Marks that one migration rolled back so the corrected file re-runs on the
# next deploy. Guarded: it touches nothing unless `migrate status` reports that
# exact migration as failed, matched as one failed entry. Run from the Model lab (script: migrate:resolve-nhl).
set -u
# Migrate commands take a session-level advisory lock: run them on the direct host, never the pooler.
export DATABASE_URL_UNPOOLED="${DATABASE_URL_UNPOOLED:-${DATABASE_URL/-pooler./.}}"
MIGRATION=20261109200100_nhl_team_pair_constraint
echo "== prisma migrate status (before) =="
before=$(npx prisma migrate status 2>&1); echo "$before"
# Guard: the failed entry must be this exact migration as one unit (see
# scripts/migrateStatusGuard.ts). Two independent greps would also pass if
# a *different* migration were the failed one.
if ! npx tsx scripts/migrateStatusGuard.ts "$MIGRATION" <<<"$before"; then
  echo "== $MIGRATION is not reported as failed: nothing changed =="
  exit 0
fi
echo "== resolving $MIGRATION as rolled back =="
npx prisma migrate resolve --rolled-back "$MIGRATION" || exit 1
echo "== prisma migrate status (after) =="
npx prisma migrate status 2>&1 || true
