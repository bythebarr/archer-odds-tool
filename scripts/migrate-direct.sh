#!/usr/bin/env bash
# Runs a Prisma migrate command on Neon's direct host. Migrate commands take a
# session-level advisory lock; through the pooler (PgBouncer, transaction mode)
# that lock stays on a pooled server connection after the command exits and
# blocks every later `prisma migrate deploy` (P1002). prisma.config.ts reads
# DATABASE_URL_UNPOOLED first.
set -eu
if [ -z "${DATABASE_URL_UNPOOLED:-}" ]; then
  export DATABASE_URL_UNPOOLED="${DATABASE_URL/-pooler./.}"
fi
case "$DATABASE_URL_UNPOOLED" in *-pooler.*) echo "Refusing: no direct (unpooled) database URL." >&2; exit 1;; esac
exec npx "$@"
