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

## The lineup and parking a sport

**Every sport is in the lineup** (un-parked 2026-10-27): NBA, NFL, UFC, MLB,
soccer, tennis and F1 all show in the nav, Home and the Slate, and their data
jobs run. F1 is results-only (`resultsOnly: true`): its pages show races and
ARCHR's probabilities, but it has no odds Slate. Soccer and tennis run on the
all-sports engine (every league and tournament the feeds carry).

The switch is still there for a sport's offseason: `parked` in
`src/lib/engine/sportsMeta.ts`. A parked sport:
- is hidden from the nav, Home, the Slate and the Discord card;
- keeps its pages working by URL, on the `/sports` hub's "Offseason" shelf;
- keeps its adapter registered, so past plays still grade.

Parking doesn't stop a sport's jobs by itself. To pause them, take them out of
`JOBS` in `src/lib/ops/schedule.ts` (and put them back when it returns).
Every job runs from the tick (below), so it never needs times of its own.

## The schedule: one tick, one wake-up per window

**Why the old windows stopped working.** By late October the schedule had drifted back up to **~50 wake-ups a day**: 76 Vercel cron entries at scattered minutes. Clustering by minute can't fix that on the Hobby plan, because Vercel fires each cron anywhere inside its scheduled hour. Separate entries can't be made to share a wake-up.

**Now `vercel.json` has a single cron: `/api/cron/tick`.** It runs 20 times a day (UTC): hourly from 12:00 to 04:00, which is 8am to midnight ET plus late games, and at 06, 08 and 10. Each tick:

1. Reads when every job last ran (PollLog `tick:<path>`).
2. Picks the ones that are due (`src/lib/ops/schedule.ts`, `JOBS`). A job is due by its own cadence (e.g. ESPN odds and fixtures every hour, results every 3 hours, nflverse every 6) or at fixed UTC hours. Fixed hours cover the credit-spending odds polls, the Discord card, the recap, crawls and backfills.
3. Calls each due job's own route, all at once (each its own function call, so a window still costs one wake-up).
4. Starts phase 2 (Discord card, recap, cleanup) once phase 1 finishes, or after 25s at the latest.

`?force=<path>` runs one job now.

**Compute.** About 20 wake-ups a day, down from ~50, for about 2 hours awake. Jobs that used to run every 3 hours now run every 1–2. Past **60%** of the compute budget, the tick runs only on even hours. Past 80%, optional jobs skip themselves, as before.

**Refresh on view** (`src/lib/ops/refreshOnView.ts`). Opening a page means the database is already awake. So any stale job behind that page runs right after the response, as its own call, sharing the tick's record. That makes it free freshness: the tick then sees the job as fresh, and a burst of viewers starts it only once. Pages and what they refresh:

| Page | Refreshes (stale after) |
|---|---|
| NBA board | ESPN odds (30 min), NBA results (60 min) |
| NBA props | NBA results (60 min), ESPN odds (30 min) |
| NFL board | ESPN odds (30 min), NFL results (60 min) |
| NFL props | NFL results (60 min), nflverse (3 h), ESPN odds (30 min) |
| Sport boards | ESPN odds (30 min); tennis fixtures (30 min) on tennis; soccer box scores (60 min) on soccer |
| Tennis / soccer props | Tennis fixtures (30 min) / soccer box scores (60 min) and ESPN odds (30 min) |
| UFC pages | Fight history (6 h) |

**To add a job:** give it a route under `/api/cron/`, add it to `JOBS` with a cadence or hours (fixed hours must be tick hours; a test checks this), and, if a page shows its data, add it to that page's `refreshOnView`.

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
  running: weather, soccer odds, tennis odds and results, and the F1/MLB
  backfills. The core jobs (NBA, NFL, UFC odds and props, results, grading,
  Discord) always run. Separately, the tick itself thins to even hours past 60%
  (see the schedule above).

## Player history backfill (NBA, NFL)

Prop hit rates, splits and the matchup read are computed from stored player game
logs. The daily results sync only looks back four days, so a fresh database
needs history once: run the **Backfill player history** workflow (Actions → Run
workflow, pick the league). It calls `/api/cron/backfill-<league>-game-logs` in 3-day chunks from the
start of last season to yesterday, then fills positions from the rosters. It is
idempotent; rerun it any time a gap is suspected. Expect it to keep the database
awake for the length of the run (well under an hour, once).

## If it happens again

1. Run **sync-free** from the Actions tab. Its first step prints the health
   check, including the database's own error message.
2. Open `/api/status`. If the guard is on, its `compute` field shows how much
   of the month's budget is used.
3. Restore database access: upgrade the plan or raise its limits in Neon (or
   wait for the monthly reset). Then redeploy the latest `main`, so any
   migrations that failed in the meantime get applied.
