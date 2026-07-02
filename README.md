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

## Automated ingestion

Three GitHub Actions workflows call bearer-secret-protected `/api/cron/*` routes instead of paying for Vercel Pro cron. They're split by cost, so nothing spends Odds API credits without you asking it to:

- `sync-schedule.yml` — **scheduled, once daily.** Extends the known MLB schedule window forward. Free (MLB Stats API).
- `sync-free.yml` — **scheduled, every 15 minutes.** Refreshes today's game statuses/scores and grades any newly-final game. Free (MLB Stats API + already-stored odds history) — safe to leave running indefinitely.
- `poll-odds.yml` — **manual only** (`workflow_dispatch`). Polls The Odds API for current lines. This is the one that costs credits, so it's not on a schedule: trigger it from the repo's Actions tab ("Run workflow") or `gh workflow run poll-odds.yml` whenever you want fresh prices. The free tier (500 credits/month) comfortably covers on-demand use; it would exhaust in a day or two if run on the same tiered cadence continuously, which is exactly why this one isn't automatic. Bump the cadence back to scheduled once running unattended is worth the ~$25-30/mo 20K-credit tier.

Once deployed, set these as GitHub repo secrets (Settings → Secrets and variables → Actions) so the workflows can reach the deployed app:

- `APP_URL` — the deployed base URL (e.g. `https://archer-odds-tool.vercel.app`)
- `CRON_SECRET` — must match the `CRON_SECRET` env var set on the deployment

Locally, hit any `/api/cron/*` route with `Authorization: Bearer $CRON_SECRET` to trigger it manually, or just run `npm run poll:odds` / `npm run sync:schedule` directly.
