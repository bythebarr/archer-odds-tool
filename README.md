# ARCHR Edge (archer-odds-tool)

A multi-sport odds and props app: every price at every book next to ARCHR's own model, for **NBA, NFL, UFC, MLB, soccer, tennis and F1**.

- **Game lines.** Moneylines, spreads, totals, team totals, halves and quarters, alternates. For each one: the best price across books, ARCHR's fair price, and the edge (EV) between them. Tap a price to add it to the slip.
- **Player props.** One layout for every sport: a line ladder, a game-by-game chart, the projection and what drives it, hit rates (L5/L10/season/vs opponent/home-away) and every book's price. ARCHR posts its own line before the books do, and the books' prices slot in when they post. Each sport adds its own panels: NBA usage, NFL snaps/air yards/red-zone looks, MLB pitcher matchups, UFC fighter metrics, tennis serve and return.
- **Matchup breakdowns.** A face-off, tale of the tape, and "why ARCHR prices it this way" for every game, bout and match.
- **Models.** Fitted and backtested, each blended with the market. Every model's accuracy and calibration are on `/models`.
- **Discord.** A daily +EV card, a free lean, a graded results recap, plus slash commands.

It's a research tool: it doesn't place bets.

## Where things are

| Path | What |
|---|---|
| `/` | Home: today across every sport |
| `/slate` | The odds Slate: every game, every market, best price vs ARCHR |
| `/nba`, `/nfl`, `/mlb`, `/ufc`, `/f1` | Sport pages (boards, game/bout pages) |
| `/nba/props`, `/nfl/props`, `/mlb/props`, `/ufc/props` | Player and fighter props |
| `/sports`, `/sports/<sport>`, `/sports/<sport>/props` | The all-sports engine: soccer, tennis and every other league the feeds carry, with soccer and tennis props |
| `/models` | Model report cards |
| `/api/cron/*` | Background jobs (bearer `CRON_SECRET`) |
| `/api/health`, `/api/status` | DB connectivity; job freshness and compute budget |

Design notes live in `docs/architecture/`. Start with `operations.md` (schedule, compute budget), `MODEL-FRAMEWORK.md`, and the per-sport props docs (`nba-props.md`, `NFL-ADVANCED.md`, `MLB-PROPS.md`, `SOCCER-PROPS.md`, `TENNIS-PROPS.md`, `UFC-PROPS.md`).

## Stack

- **App:** Next.js 16 (App Router, TypeScript), deployed on Vercel.
- **Database:** Prisma 7 on Postgres, Neon in production. The client is generated to `src/generated/prisma`; import it from `@/generated/prisma/client`.

**Data sources:**
- **Odds:** The Odds API or ParlayAPI (optionally OddsBlaze per sport), odds-api.io for the long tail, and ESPN's free DraftKings lines.
- **Schedules, scores and box scores:** ESPN and the MLB Stats API.
- **UFC:** Cito, plus UFCStats via a public mirror.
- **Tennis:** the Sackmann ATP/WTA archive plus ESPN.
- **NFL advanced stats:** nflverse.

## Local development

Requires Docker (for local Postgres). Odds keys are optional: without one, the app still runs on ESPN's free lines, and ARCHR's own prices still show.

```bash
cp .env.example .env      # every variable, with what it does; fill in what you need
docker compose up -d      # local Postgres on :5432
npx prisma migrate dev    # apply the schema
npm run dev               # http://localhost:3000
```

```bash
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest
npm run build        # production build
npx prisma studio    # browse the local DB
```

Run any job locally with `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/<job>`.

## Background jobs

**Vercel Cron runs one route, `/api/cron/tick`, about 20 times a day.** Each tick wakes the database once and runs every job that's due, by its own cadence or at fixed hours: odds, fixtures, results, box scores, history imports, grading and the Discord posts. The schedule lives in `src/lib/ops/schedule.ts`.

**Pages also refresh the data behind them when it's stale.** Viewing a page wakes the database anyway, so this costs nothing extra.

Why it's built this way: the production database is billed by the hours it's awake. See `docs/architecture/operations.md`.

**GitHub Actions** call the same `/api/cron/*` routes. They're manual, except the weekly Model Lab:
- `model-lab.yml`: weekly (Monday), plus manual. Runs the backtests and fits against production, and saves the report cards behind `/models`.
- `sync-free.yml`: health check plus a one-off refresh.
- `backfill-history.yml`, `all-sports-fill.yml`: one-time history fills.
- `poll-odds*.yml`, `poll-player-props.yml`: on-demand odds polls. These spend credits.
- `fire-card.yml`, `results-tick.yml`: post the Discord card or recap now.
- `reset-ledger.yml`: wipes the results ledger. Destructive.
- `ops-status.yml`: read-only status.
- `ci.yml`: lint, typecheck, tests, build.

The workflows need two repo secrets (Settings → Secrets and variables → Actions): `APP_URL` (the deployed base URL) and `CRON_SECRET` (the same value as the deployment's). Model Lab also needs `DATABASE_URL`.
