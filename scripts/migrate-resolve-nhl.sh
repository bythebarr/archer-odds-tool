#!/usr/bin/env bash
# One-off unblock for production deploys (see commit 387d85f): the original
# 20261109200100_nhl_team_pair_constraint failed inside a Vercel build, and its
# failed record makes every later `prisma migrate deploy` stop with P3009.
# Marks that one migration rolled back so the corrected file re-runs on the
# next deploy. Guarded: it touches nothing unless `migrate status` reports that
# exact migration as failed. Run from the Model lab (script: migrate:resolve-nhl).
set -u
MIGRATION=20261109200100_nhl_team_pair_constraint
echo "== prisma migrate status (before) =="
before=$(npx prisma migrate status 2>&1); echo "$before"
if ! grep -q "$MIGRATION" <<<"$before" || ! grep -qi "failed" <<<"$before"; then
  echo "== $MIGRATION is not reported as failed: nothing changed =="
  exit 0
fi
echo "== resolving $MIGRATION as rolled back =="
npx prisma migrate resolve --rolled-back "$MIGRATION" || exit 1
echo "== prisma migrate status (after) =="
npx prisma migrate status 2>&1 || true
