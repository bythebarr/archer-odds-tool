@AGENTS.md

## Project-specific notes

- Local Postgres runs via `docker compose up -d` (not `npx prisma dev`). `.env` already points `DATABASE_URL` at it.
- Prisma generator is `prisma-client` (not the old `prisma-client-js`), output to `src/generated/prisma` (gitignored, regenerate with `npx prisma generate`). This generator requires a driver adapter — `PrismaClient` must be constructed with `new PrismaPg({ connectionString })` (see `src/lib/prisma.ts`); a bare connection string alone will fail to type-check.
- Import the client as `@/generated/prisma/client`, not `@prisma/client`.
- Full architecture/design rationale and milestone plan: `/home/codespace/.claude/plans/sequential-moseying-treehouse.md`.
