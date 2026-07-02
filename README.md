# archer-odds-tool

An MLB odds line-shopping tool: pick a price range with a slider and see every US-legal sportsbook currently quoting a line in that range, alongside each team/side's rolling historical hit rate and two side-by-side EV estimates (de-vigged market consensus vs. historical hit rate).

Research/discovery tool only in v1 — no bet placement or tracking.

See `/home/codespace/.claude/plans/sequential-moseying-treehouse.md` (or ask Claude) for the full design rationale and milestone plan.

## Stack

Next.js (TypeScript, App Router) + Prisma + Postgres, deployed as a single app on Vercel. Odds data from [The Odds API](https://the-odds-api.com); schedule/results from the free [MLB Stats API](https://statsapi.mlb.com).

## Local development

Requires Docker (for local Postgres) and an [The Odds API](https://the-odds-api.com) key for anything that touches live odds.

```bash
cp .env.example .env      # fill in ODDS_API_KEY once you have one
docker compose up -d      # starts local Postgres on :5432
npx prisma migrate dev    # applies the schema
npm run dev               # http://localhost:3000
```

Useful scripts:

```bash
npm run lint        # eslint
npm run typecheck    # tsc --noEmit
npm run build        # production build
npm test              # vitest
npx prisma studio     # browse local DB
```

`GET /api/health` checks DB connectivity.
