# Operations: schedule, cleanup, and the compute budget

## Why this exists

On **2026-10-14 at about 00:30 UTC**, the production database (Neon) began
refusing every query:

> `Your account or project has exceeded the quota. Upgrade your plan to increase limits.`

From then on, every database-backed page showed "Something went wrong", and
every deploy failed at its `prisma migrate deploy` step. The data didn't cause
this. Neon bills compute by the hours the database is awake, and the database
was almost never asleep:
- `sync-free.yml` woke it every 15 minutes (96 times a day);
- Vercel Cron added about 41 more wake-ups, at scattered minutes.

Neon suspends a database after about 5 idle minutes, so each wake-up costs
roughly 5 minutes or more of compute. Spread around the clock like that, the
wake-ups left the database almost no time asleep.

## The schedule: clustered wake windows

`vercel.json` groups every job into **18 hourly windows** (UTC). Inside a
window:
- primary jobs run at `:00`;
- dependent jobs run at `:02`–`:04` (grade after sync, post results after
  grading, the Discord card after polls).

Because everything in a window lands within a few minutes, a window costs one
wake-up. Each job keeps roughly the same time of day it had before.

**Rough cost:** 18 windows × ~10 minutes awake ≈ 3 hours a day ≈ 90 hours a
month. At Neon's smallest compute size (0.25 CU) that's about 22 CU-hours, or
roughly $5 a month at $0.22 per CU-hour. Page views wake the database too, on
top of that.

**Rules for adding a job:**
- Put it in an existing window, not a new time.
- Use minute `:00`, or `:02`–`:04` if it depends on another job in the same
  window.
- A new hour adds one wake-up a day; a new minute inside a window adds nothing.

`sync-free.yml` is manual now. It prints `/api/health` and `/api/status`, then
runs one sync, which makes it the quickest way to see what production is doing
from GitHub.

## Cleanup (`/api/cron/cleanup`, daily in the 09:00 window)

`src/lib/ops/cleanup.ts`. Prunes rows nothing reads any more:

| Removed | When |
| --- | --- |
| Price snapshots (`OddsSnapshot`, `PlayerPropSnapshot`, `NbaPropSnapshot`) | game started over 90 days ago |
| `CurrentNbaPropLine` | game started over 2 days ago |
| `PollCreditLog` | over 90 days old |

**Never removed:** games, closing lines, graded outcomes, player game logs,
posted plays, and model predictions.

**How a run works:**
- It deletes 50 games' worth of rows at a time, through each table's `gameId`
  index, so it never scans a whole table.
- It stops after 25 seconds; any backlog carries over to the next day's run.
- It records its result in PollLog (`cleanup`), which shows on `/api/status`.

## Compute budget guard

`src/lib/ops/computeBudget.ts`. This is optional and fails open: with no
credentials, or if Neon's API errors, every job runs as normal. To turn it on,
set these in Vercel:

- `NEON_API_KEY`: Neon console → Account settings → API keys
- `NEON_PROJECT_ID`: Neon console → Project settings
- `COMPUTE_BUDGET_CU_HOURS`: the monthly budget (default 50, about $11)

**What it does:**
- `/api/status` reports this month's compute use (CU-hours, as a share of the
  budget). It reads Neon's control plane, which doesn't wake the database, so
  the number is there even while the database is refusing queries.
- Past **80%** of the budget, these optional jobs return `skipped` instead of
  running: weather, soccer odds, tennis odds and results, and the UFC/F1/MLB
  backfills. NBA and NFL odds and props, results, grading, and Discord always
  run.

## If it happens again

1. Run **sync-free** from the Actions tab. Its first step prints the health
   check, including the database's own error message.
2. Open `/api/status`. If the guard is on, its `compute` field shows how much
   of the month's budget is used.
3. Restore database access: upgrade the plan or raise its limits in Neon (or
   wait for the monthly reset). Then redeploy the latest `main`, so any
   migrations that failed in the meantime get applied.
