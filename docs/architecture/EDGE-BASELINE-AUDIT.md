# ARCHR Edge — Platform Baseline Audit

**Branch:** `recovery/platform-baseline` (off `main` @ `84b0aec`, working tree clean at audit time)
**Date:** 2026-09-17
**Scope:** Read-only recovery/stabilization audit. No source files were modified except this document. No dependencies were upgraded, no migrations applied to a remote database, no deploys made, no paid API calls issued.

This document is evidence-based: every claim below cites a file path and, where practical, a line number or line range as of this branch's HEAD. Where something could not be verified from the repository alone (e.g. state of external accounts, secrets, or dashboards), it is called out explicitly in ["What could not be verified"](#what-could-not-be-verified) rather than assumed.

---

## 1. Commands run and exact results

All commands were run from the repo root after `npm ci` (which itself ran `prisma generate` via `postinstall`), then `npx prisma generate` was re-run explicitly.

| Command | Result | Detail |
|---|---|---|
| `git status` / `git branch --show-current` | ✅ PASS | Started on `main`, working tree clean, up to date with `origin/main`. |
| `git checkout -b recovery/platform-baseline` | ✅ PASS | Branch created and checked out. |
| `npm ci` | ✅ PASS | 757 packages installed. `postinstall` ran `prisma generate` → Prisma Client 7.8.0 generated to `src/generated/prisma`. **23 vulnerabilities reported by npm** (8 moderate, 14 high, 1 critical) — not investigated further per the "don't fix yet" instruction; see the issue table. A Prisma 7→8 major-version update notice was printed (not applied — upgrades are out of scope). |
| `npx prisma generate` | ✅ PASS | Re-confirmed: client generated in 512ms with no errors. |
| `npm test` (vitest run) | ✅ PASS | **46 test files, 429 tests, all passed.** Duration 13.82s. No test file touches `prisma.*` (`grep -rl "prisma\." src --include=*.test.ts` returns nothing) and no local Postgres was running (`docker ps` empty) during the run — the entire suite is pure unit tests over business logic (grading math, odds math, devig, name normalization, calibration harness, etc.), not integration tests against a live DB. Matches the audit's stated baseline exactly (46 files / 429 tests). |
| `npm run typecheck` (`tsc --noEmit`) | ✅ PASS | No output, no errors. |
| `npm run lint` (eslint) | ⚠️ PASS WITH FINDINGS | **2 errors, 6 warnings**, matching baseline exactly: <br>Errors — `@typescript-eslint/no-explicit-any` at `scripts/providers/probe.ts:205` (`function coverage(events: any[])`) and `scripts/providers/probe.ts:258` (`const rows = out.body as any[]`). Both are in a manual odds-provider diagnostic CLI script, not app runtime code.<br>Warnings (all `no-unused-vars`) — `scripts/backtest-nfl-clv.ts:1` (`NflGame`), `scripts/calibrate-pitcher-props.ts:260` (`samples`), `src/components/ufc/UfcOddsEvCard.tsx:4` (`americanToDecimal`), `src/lib/card/line.ts:14` (`unitsFor`), `src/lib/logos.ts:7` (`_bookKey`), `src/lib/ufc/backfillUfc.ts:2` (`recordPollLog`). |
| `npm run build` (`next build`) | ✅ PASS | Next.js 16.2.10 (Turbopack). Compiled successfully in 18.7s, TypeScript pass in build took 15.3s, all API/cron/page routes resolved. **66 total routes** counted directly from the printed route table (11 static `○` + 55 dynamic `ƒ`) — see §6 for the cron subset. The `(40/40)` in the build log's "Generating static pages" progress line is **not** a route count; it's Next.js's own internal build-phase progress counter (verified against the Step 2 adversarial review — see below), and this document's earlier text conflated the two, misstating the total as "68." Corrected here; see the Step 2 review note for how this was verified and why it is not evidence of unintended route generation. |

Commit count at HEAD: `git rev-list --count HEAD` → **323** (audit baseline said "roughly 325"; 2 additional commits have landed since, consistent).

---

## 2. Current sports in the registry

The registry is `SPORTS: SportAdapter[]` in `src/lib/engine/registry.ts:25`, sourced from client-safe metadata in `src/lib/engine/sportsMeta.ts:21-32`. **Six sports are registered, in this display order:**

| Key | Label | Route | `resultsOnly` | `signalOnly` |
|---|---|---|---|---|
| `mlb` | MLB | `/mlb` | false | false |
| `nfl` | NFL | `/nfl` | false | false |
| `ufc` | UFC | `/ufc` | false | false |
| `tennis` | Tennis | `/tennis` | false | false |
| `soccer` | Soccer | `/soccer` | false | false |
| `f1` | F1 | `/f1` | **true** | false |

(`sportsMeta.ts:22-31`). All six `signalOnly` flags currently read `false` — the flag exists as live machinery (see §7) but nothing is currently suppressed by it.

**Stale comment found in the registry itself:** `src/lib/engine/registry.ts:9-10` still says *"NFL + tennis are `meta.signalOnly`"*, but `sportsMeta.ts:25,29` show both cleared (`signalOnly: false`), with `sportsMeta.ts:27-28` explaining tennis's flag was cleared 2026-07-21 once ESPN's free scoreboard started settling matches. `registry.ts`'s header comment was never updated after that change — a docstring now describing behavior the code no longer has.

---

## 3. Adapters: full vs. thin/partial

| Adapter | File | Lines | Character |
|---|---|---|---|
| MLB | `src/lib/engine/adapters/mlb.ts` | 333 | **Full** — real ingest, model-priced board, backtested model, full game-line + prop grading. |
| UFC | `src/lib/engine/adapters/ufc.ts` | 216 | **Full** — real ingest, model-priced board (fighter-math), on-view `refresh`, backtested model, moneyline grading. |
| Tennis | `src/lib/engine/adapters/tennis.ts` | 235 | **Modeled, but deliberately non-postable as picks** — real ingest, model-priced board (surface Elo), backtested model, self-contained grading. See §7 for how "never auto-posted as +EV picks" is (and isn't) enforced. |
| NFL | `src/lib/engine/adapters/nfl.ts` | 107 | **Thin (market feed only)** — real odds ingest, empty board (`listPlays` always returns `[]`, `nfl.ts:49-51`), no `model` field wired despite a built, backtested Elo model existing at `src/lib/nfl/model.ts` and `src/lib/nfl/elo.ts` (see §8). Self-contained grading via the shared `gradeGame` (§4). |
| Soccer | `src/lib/engine/adapters/soccer.ts` | 49 | **Thin (market feed only)** — real odds ingest, empty board (`soccer.ts:33-35`), no `model` field wired despite a built, backtested Poisson model existing at `src/lib/soccer/model.ts` + `src/lib/soccer/poisson.ts`. `grade` is hardcoded to always return `"void"` (`soccer.ts:38-40`) since nothing is ever posted for it to grade. |
| F1 | `src/lib/engine/adapters/f1.ts` | 49 | **Thin / results-only** — ingest pulls the season schedule only (no odds feed at all — F1 has no bettable markets wired, `F1_MARKETS = []` at `f1.ts:18`). `listPlays` and `grade` are permanently empty/void (`f1.ts:33-40`). |

---

## 4. Ingest / list plays / model / grade matrix

| Sport | Ingest | List plays (board) | Model | Grade |
|---|---|---|---|---|
| MLB | ✅ schedule + probable pitchers (`mlb.ts:305-317`) | ✅ model-priced, every positive-model-EV play (`mlb.ts:319-322`, `selectBoardPlays` at `mlb.ts:241-248`) | ✅ win-probability model; **calibration verdict = `"marginal"`, Brier 0.2499 vs. base-rate 0.2499 → 0.2489** (`mlb.ts:177-189`) — essentially no proven edge | ✅ game lines graded directly off `Game.homeScore/awayScore` (pure function, no DB lookup beyond the game row); props graded off `PlayerGameLog` (`mlb.ts:268-297`) |
| UFC | ✅ Cito recent + upcoming events (`ufc.ts:195-205`) | ✅ fighter-math priced (`ufc.ts:145-149`) | ✅ fighter-math model; **calibration verdict = `"trusted"`, n=1227** (`ufc.ts:79-91`) | ✅ moneyline vs. bout winner, `"pending"` until fight night settles (`ufc.ts:167-185`) |
| Tennis | ✅ live odds ingest (`tennis.ts:104-112`) | ✅ surface-Elo priced within a believability band (0.02–0.20 modelEv) (`tennis.ts:157-197`) | ✅ surface Elo; **calibration verdict = `"trusted"`, n=20000** (`tennis.ts:88-101`) — but the model's own CLV backtest showed it **loses ~1–3% against modern closing lines** (`tennis.ts:38-43`), so calibration "trusted" ≠ "profitable" | ✅ self-graded off ESPN scoreboard via `GameOutcome` (`tennis.ts:212-225`) |
| NFL | ✅ live odds ingest (`nfl.ts:33-41`) | ❌ always `[]` — Elo model exists but isn't wired (`nfl.ts:44-51`) | Built (`src/lib/nfl/model.ts`, `src/lib/nfl/elo.ts`) but **not attached** to `nflAdapter` — no `model` field in `nfl.ts:100-107` | ✅ self-graded via shared `gradeGame` inside `syncAndGradeNflResults` (`src/lib/nfl/results.ts:109`, calling `src/lib/grading/gradeOutcomes.ts:91`) |
| Soccer | ✅ live odds ingest (`soccer.ts:22-30`) | ❌ always `[]` (`soccer.ts:32-35`) | Built (`src/lib/soccer/model.ts`, `src/lib/soccer/poisson.ts`) but **not attached** to `soccerAdapter` — no `model` field in `soccer.ts:42-49` | Hardcoded `"void"` — never runs against real data (`soccer.ts:37-40`) |
| F1 | ✅ season schedule only, no odds (`f1.ts:20-30`) | ❌ always `[]`, no markets exist (`f1.ts:18,32-35`) | None | Hardcoded `"void"` (`f1.ts:37-40`) |

**Trust gate is built but not wired to anything that posts.** `src/lib/engine/trust.ts:28-30` defines `isModelTrusted(sportKey)` — "true ONLY for a `trusted` verdict" — and is re-exported from `src/lib/engine/index.ts:20`. A repo-wide search (`grep -rn "isModelTrusted" src`) shows it is **never called anywhere** except its own definition. `trust.ts:10-12` says this out loud: *"wiring it into what actually posts... is a separate, owner-gated switch."* Practically: MLB's board (`mlb.ts:319-322`) posts every play with `modelEv > 0` regardless of the model's `"marginal"` (no-edge) calibration verdict — the gate that would suppress an unproven model exists but is inert.

---

## 5. Odds providers and environment variables

**Odds/results data sources:**

| Provider | Used for | Key env var | Cost | Where read |
|---|---|---|---|---|
| The Odds API (TOA) | Default game-odds provider, all sports | `ODDS_API_KEY` | Free tier usable; paid tiers for volume | `src/lib/odds/oddsApiClient.ts:26-38` |
| ParlayAPI | Preferred provider when its key is set (carries Pinnacle for a sharp de-vig baseline); URL/shape-compatible with TOA | `PARLAY_API_KEY` | Paid (per-credit) | `src/lib/odds/oddsApiClient.ts:22-24,31` |
| OddsBlaze | Opt-in **per sport**, off by default | `ODDSBLAZE_API_KEY` + one of `MLB_ODDS_PROVIDER` / `NFL_ODDS_PROVIDER` / `TENNIS_ODDS_PROVIDER` / `SOCCER_ODDS_PROVIDER` / `UFC_ODDS_PROVIDER` = `oddsblaze` | Paid | `src/lib/odds/providers/registry.ts:26-53`, `src/lib/odds/providers/oddsblaze/client.ts:17` |
| Global provider override | Forces TOA/Parlay globally | `ODDS_PROVIDER` | n/a | `oddsApiClient.ts:22-23` |
| Cito API | UFC fighter/event/results data (not odds) | `CITO_API_KEY` | Paid (500/mo free tier per code comments) | `src/lib/ufc/citoApiClient.ts:117` |
| ESPN scoreboard | NFL + tennis results/settlement | none | Free, unkeyed | `src/lib/nfl/espnScoreboard.ts`, `src/lib/tennis/espnScoreboard.ts` (no `process.env` references) |
| MLB Stats API | MLB schedule/scores/pitchers/boxscores | none | Free, unkeyed | `src/lib/mlb/*.ts` (no `process.env` references) |
| Jolpica F1 API | F1 season schedule + results (Ergast successor) | none | Free, unkeyed, rate-limited | `src/lib/f1/jolpicaApiClient.ts:1-9` |
| football-data source | Soccer model inputs | none referenced | Free | `src/lib/soccer/footballData.ts` (no `process.env` references) |

**Other operational env vars found in code:** `PLAYER_PROPS_ODDS_ENABLED` (gates the props poll cron, `src/app/api/cron/poll-player-props/route.ts:27`), `CRON_SECRET` (bearer auth for all `/api/cron/*`, `src/lib/cronAuth.ts`), `SITE_ACCESS_PASSWORD` (site-wide Basic Auth gate), `DISCORD_WEBHOOK_URL`, `DISCORD_FREE_WEBHOOK_URL`, `DISCORD_SLATE_WEBHOOK_URL`, `DISCORD_RESULTS_WEBHOOK_URL`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_GUILD_ID`.

**`.env.example` is materially out of date.** It documents only `DATABASE_URL`, `ODDS_API_KEY`, `CRON_SECRET`, `SITE_ACCESS_PASSWORD`, `DISCORD_WEBHOOK_URL`, `DISCORD_FREE_WEBHOOK_URL`, `DISCORD_RESULTS_WEBHOOK_URL` (`.env.example:1-23`). **Missing entirely:** `PARLAY_API_KEY`, `ODDSBLAZE_API_KEY`, `ODDS_PROVIDER`, all five per-sport `*_ODDS_PROVIDER` overrides, `CITO_API_KEY`, `PLAYER_PROPS_ODDS_ENABLED`, `DISCORD_SLATE_WEBHOOK_URL`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_GUILD_ID`. A developer following only `.env.example` cannot discover UFC, tennis/soccer OddsBlaze routing, player props, or three of the four Discord channels/the slash-command bot exist at all.

---

## 6. Cron routes and workflows, grouped by sport/function

**15 cron routes exist** under `src/app/api/cron/`. Scheduling is split across **two independent mechanisms** — Vercel Cron (`vercel.json`) and GitHub Actions `schedule:` triggers (`.github/workflows/*.yml`) — which the codebase's own commit history says are not interchangeable (see the P1 finding below).

| Route | Function | Sport(s) | Scheduled in `vercel.json`? | Scheduled in GitHub Actions? |
|---|---|---|---|---|
| `sync-schedule` | MLB schedule window extension | MLB | ✅ daily `0 9 * * *` | Manual only (`sync-schedule.yml`, `workflow_dispatch`) |
| `sync-results` | MLB score/status sync, probable pitchers, lineups, poll-odds self-heal, player game logs, stranded-game heal, preseason purge, UFC-upcoming self-heal | MLB (+ UFC self-heal) | ✅ 5x daily | ✅ `sync-free.yml`, every 15 min |
| `grade-outcomes` | Grades final MLB games into `GameOutcome` (h2h/spreads/totals) via `gradeUngradedGames` | MLB | ❌ **not present** | ✅ `sync-free.yml` (every 15 min) and `poll-odds.yml` (manual) |
| `poll-odds` | Game-line odds poll | MLB | ✅ 8x daily (fixed times, Hobby-plan workaround — see commit `84b0aec`) | Manual only (`poll-odds.yml`) |
| `poll-odds-nfl` | NFL odds poll | NFL | ✅ 2x daily | none |
| `poll-odds-tennis` | Tennis odds poll | Tennis | ✅ 1x daily | Manual only (`poll-odds-tennis.yml`) |
| `poll-odds-soccer` | Soccer odds poll | Soccer | ✅ 4x daily | none |
| `poll-player-props` | MLB player-prop odds poll (gated on `PLAYER_PROPS_ODDS_ENABLED`) | MLB | ✅ 1x daily | Manual only (`poll-player-props.yml`) |
| `sync-results-nfl` | NFL result sync + self-contained grading | NFL | ✅ 2x daily | none |
| `sync-results-tennis` | Tennis result sync + self-contained grading | Tennis | ✅ 5x daily | none |
| `backfill-player-game-logs` | MLB boxscore backfill (props hit-rate engine) | MLB | ✅ daily | none |
| `backfill-ufc` | UFC recent/upcoming event sync + pending-play settle | UFC | ✅ daily | none |
| `backfill-f1` | F1 season schedule/results backfill (free Jolpica) | F1 | ✅ daily | none |
| `post-discord` | Daily card + free-play + slate post, tip post | All (registry-driven) | ✅ 13x daily (hourly 11:05–23:05 UTC) | none |
| `post-results` | Daily #results recap once a date's tracked plays settle | All (registry-driven) | ✅ 8x daily | `results-tick.yml` (manual diagnostic tick) |

**Finding: `grade-outcomes` is the only writer of MLB `GameOutcome` rows, and it has no Vercel Cron entry — its sole schedule is GitHub Actions' `sync-free.yml` (`*/15 * * * *`).** This matters because the same repository's own commit history documents that GitHub Actions `schedule:` triggers have already failed silently in this project: `.github/workflows/poll-odds.yml:1-8`, `poll-odds-tennis.yml:1-6`, and `sync-schedule.yml:1-5` each carry a comment stating *"GH Actions' own `schedule:` trigger was confirmed to silently not fire at all for a full day+"* — which is why those three were migrated to Vercel Cron with GitHub Actions demoted to manual fallback. `grade-outcomes` was **not** given the same treatment: it still depends solely on the failure-prone mechanism, with no Vercel Cron entry and no manual-fallback workflow of its own. See the P1 entry in the issue table — this is the "reports success but may store no usable data" risk realized at the scheduling layer rather than the code layer: `gradeUngradedGames` (`src/lib/grading/gradeOutcomes.ts:133-143`) is itself correct, but nothing reliably calls it in production.

**GitHub Actions workflows** (`.github/workflows/`, 9 total): `ci.yml` (build+lint+test+typecheck on push/PR, no schedule), `sync-schedule.yml` (manual fallback), `sync-free.yml` (every 15 min: sync-results → grade-outcomes → poll-odds self-heal tick), `poll-odds.yml` (manual, costs credits), `poll-odds-tennis.yml` (manual, costs credits), `poll-player-props.yml` (manual, costs Parlay credits), `fire-card.yml` (manual, **posts to Discord**, requires explicit `confirm: true` input), `reset-ledger.yml` (manual, **destructive** — wipes `PostedPlay` history), `results-tick.yml` (manual diagnostic tick + admin-auth probe).

**Admin API routes** (`src/app/api/admin/`, all `CRON_SECRET`-gated): `fire-card` (force-post today's card), `refresh-odds`, `reset-ledger` (destructive), `settle-ufc`.

---

## 7. Discord's dependencies

Discord code lives in `src/lib/discord/` (postCard, postResults, postTips, valueCheck, gradePlay, postMarker, brand, schedule), `src/app/api/discord/interactions/route.ts` (slash commands), `src/app/api/cron/post-discord` and `post-results`, and `scripts/discord/*` (provisioning/admin CLIs, not runtime).

**Reads from the sport-engine registry, not hardcoded sports.** `postCard.ts:6` imports `SPORTS` from `@/lib/engine` and iterates it directly (`assembleSections` at `postCard.ts:189`, `collectPlays` at `postCard.ts:247-274`) — no MLB/UFC branch exists in the posting code itself; section chrome (`chromeFor`, `postCard.ts:56-64`) derives entirely from each adapter's own `meta`.

**DB models read/written by Discord code:**
- `PostedPlay` — written by `recordPlays` (`postCard.ts:318-347`) for every carded/free play (upsert, keyed on `postedForDate` + `playKey`); read/updated by `gradePending`/`settlePlay` (`postResults.ts:121-149`) to settle plays.
- `CardSelection` — read via `getSelection(dateEt)` (`postCard.ts:420`, defined in `src/lib/card/selection.ts:40-57`) to know the owner's handpicks for `#todays-card`/`#free-play` vs. the unpicked `#ev-slate`.
- `PollLog` — read/written by `postMarker.ts`'s `alreadyPosted`/`markPosted` (idempotency markers keyed on job name + date) and by every cron route's `recordPollLog` call for `/api/status` visibility.
- Each adapter's own storage — `listPlays`/`grade` read whatever tables that adapter owns (`Game`, `GameOutcome`, `PlayerGameLog`, `UfcBout`, `TennisRating`, etc.) — Discord code never queries these directly; it always goes through `getAdapter(sport)` (`postResults.ts:4,128,143`).

**The `signalOnly` filter exists and is real code, but currently excludes nothing.** `excludeSignalOnly` (`postCard.ts:241-244`) drops any sport whose `meta.signalOnly` is true from the posted board — this is the "priced but can't be settled" safety valve described in `types.ts:39-51`. As of this audit **every** registered sport has `signalOnly: false` (§2), so this filter is presently a no-op. Tennis's *separate* claim in `tennis.ts:41-43` — that its model output is "SIGNAL-ONLY, never auto-posted as +EV picks" — is a different, model-quality-based statement (its CLV backtest loses to closing lines) and is enforced differently: tennis plays still flow into `collectPlays()` and can appear on the unstaked `#ev-slate` (`postCard.ts:526-539`), but only reach the staked `#todays-card`/`#free-play`/ledger if the owner manually selects them via `CardSelection` in `/deck` — there is no code-level block specific to tennis beyond the owner's own picking discipline. This is worth knowing precisely, since the comment in `tennis.ts` reads as a stronger guarantee than the code actually enforces.

**Env vars, each independently dormant:**
- `DISCORD_WEBHOOK_URL` — `#todays-card`. **Required**; unset → `postDailyCardToDiscord` no-ops entirely (`postCard.ts:474-475`) and the `post-discord` cron becomes a pure no-op.
- `DISCORD_FREE_WEBHOOK_URL` — `#free-play`, optional (`postCard.ts:509-524`).
- `DISCORD_SLATE_WEBHOOK_URL` — `#ev-slate`/"the firehose", optional (`postCard.ts:527-539`).
- `DISCORD_RESULTS_WEBHOOK_URL` — `#results` recap, optional (`postResults.ts:286-287`).
- `DISCORD_PUBLIC_KEY` — slash-command signature verification; unset → `/api/discord/interactions` returns 503 for every request (`interactions/route.ts:35-37`).
- `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_GUILD_ID` — used only by offline provisioning/admin scripts (`scripts/discord/*`, `scripts/register-discord-commands.ts`), never by the deployed app.

**Upstream data dependencies for Discord to have anything to post:** `post-discord` calls `collectPlays(dateEt)` (`postCard.ts:247-274`), which calls every adapter's `refresh?()` then `listPlays(dateEt)` — so the card is only as fresh as the last successful odds poll for each sport (§6) and, for MLB, as complete as whatever `sync-schedule`/`sync-results` most recently wrote. `post-results` calls `gradePending(dateEt)` (`postResults.ts:121-149`), which for MLB game lines is self-sufficient (grades directly off `Game.homeScore/awayScore`, §4) but for MLB **props** depends on `PlayerGameLog` having synced (`backfill-player-game-logs`/`sync-results`), and for NFL/tennis depends on their own independent result-sync crons having already run and written `GameOutcome`.

**Slash commands / interactions:** `src/app/api/discord/interactions/route.ts` (120 lines) handles Discord's PING handshake and one command, `/value` (`valueCheck.ts`), which pulls `collectPlays(todayEt())` (read-only — same board-collection path as the poster) and matches/evaluates a user-supplied selection against it; the reply is ephemeral (`EPHEMERAL = 1 << 6`, `interactions/route.ts:28`) so pricing isn't leaked publicly. No DB writes originate from this route.

---

## 8. MLB-specific assumptions living outside the MLB adapter

- **`src/lib/queries/games.ts`** — every query in the file filters `sport: "mlb"` (lines 60, 146, 168), and the file's own header comment (`games.ts:28-30`) states this explicitly. The file lives in the generic-sounding `src/lib/queries/` directory, not `src/lib/mlb/`, so its single-sport nature isn't visible from its location.
- **`src/lib/grading/gradeOutcomes.ts`** — `GRADABLE_TEAM_SPORTS = new Set(["mlb", "nfl"])` (line 80) and `gradeUngradedGames` filters `where: { sport: "mlb", ... }` (lines 134-135) — this shared-sounding grading module is MLB-only in its batch-grade entry point even though its per-game `gradeGame` function is sport-agnostic and is in fact reused by NFL (`src/lib/nfl/results.ts:21,109`).
- **`src/lib/queries/oddsPool.ts`** — the shared odds-pool query (used by both the MLB and tennis adapters' `listPlays`) hardcodes `sport: { in: ["mlb", "tennis", "soccer"] }` (line 249) and has several more `g.sport === "mlb"` branches (lines 121, 126, 166, 214, 276, 335) for MLB-only fields like `mlbTeamId`. NFL is excluded from this shared pool by name, consistent with NFL's board being intentionally empty today (§4), but it means lighting up NFL's board later requires editing this list, not just wiring `nfl.ts`'s `model` field.
- **`src/lib/nav.ts:25-30`** — `PRIMARY_SPORTS = new Set<NavSport>(["mlb", "ufc"])` hardcodes which two sports get a mobile bottom-nav slot. Worth noting, but this is a weaker finding than it first looks: the code's own comment explicitly frames it as "a nav-presentation choice, not sport identity" and types it `NavSport` specifically so it can't name a sport outside the registry — i.e. it's a deliberate, type-guarded UX curation choice (which sports are prominent enough for a scarce nav slot), not an accidental parallel sport-list of the kind `sport-engine.md` warns about. Listed here for completeness, not as a structural defect.
- **Props subsystem is entirely MLB-shaped at the schema level** — see §9; this is the deepest and hardest-to-miss MLB assumption, since it lives in `prisma/schema.prisma` rather than application code.
- **`prisma/schema.prisma:1`** — the file's own header comment still reads `// Prisma schema for archer-odds-tool (v1: MLB game lines only)`, despite the same file now containing full table families for NFL, UFC, tennis, soccer, and F1.

---

## 9. Closed enums/schemas that obstruct adding arbitrary sports and props

- **`StatCategory` enum (`prisma/schema.prisma:286-297`)** is closed to eleven MLB batting/pitching stats (`hits`, `totalBases`, `homeRuns`, `rbi`, `runs`, `battingStrikeouts`, `pitcherStrikeouts`, `earnedRuns`, `hitsAllowed`, `walksAllowed`, `outsRecorded`). There is no NFL, tennis, soccer, or UFC equivalent.
- **`PlayerPropSnapshot` and `CurrentPlayerPropLine` (`schema.prisma:439-480`)** — the two tables that hold *all* prop odds in the system — hardcode `mlbPlayerId: String` with a foreign key straight to `MlbPlayer`, and `statCategory: StatCategory`. **A prop for any non-MLB player or any non-MLB stat cannot be stored without a schema migration.** This directly contradicts `SportAdapter.PropSpec`'s own docstring in `src/lib/engine/types.ts:136-145`, which describes itself as *"an open, adapter-declared prop type — replaces the closed MLB `StatCategory` enum... the door to 'every prop in every sport.'"* The application-level type (`PropSpec`) was generalized in the sport-engine refactor; the underlying Prisma tables were not, so the "door" the type comment describes doesn't yet exist at the persistence layer.
- **`PostedPlay.mlbPlayerId` / `PostedPlay.statCategory` (`schema.prisma:551-552`)** — same closed-`StatCategory` constraint on the ledger table that records what was actually posted to Discord, even though `PostedPlay.sport` was deliberately generalized to a plain string specifically so *"a new sport flows through the ledger/grader without a DB enum migration"* (`schema.prisma:540-542`). The generalization was applied to the sport discriminator but not to the prop-grading columns on the same row.
- **`MarketType` enum (`schema.prisma:13-17`)** is closed to `h2h | spreads | totals` — no representation for markets that don't map to those three (F1 podium/pole, boxing method-of-victory, golf top-N, tennis game/set totals). `MarketKind` (`src/lib/queries/oddsPool.ts:32`) is a matching closed string union `"ml" | "spread" | "total" | "prop"`.
- **`Sport` enum (`schema.prisma:50-56`)** does not include `f1` at all — F1 rides an entirely separate table family (`F1Driver`/`F1Constructor`/`F1Circuit`/`F1Race`/`F1RaceResult`, `schema.prisma:844-936`) with no relation to `Game`. This is a deliberate, documented choice (F1 has no bettable markets), but it means the `Sport` enum cannot be treated as "the list of sports" for any consumer — `sport-engine.md:18-20` calls this out as one of the "four disagreeing lists of sports" the sport-engine refactor was meant to fix, and it remains true for this one enum specifically since F1 was intentionally kept off `Game`.

**Net effect:** the *adapter* layer (`SportAdapter`, `PropSpec`, `SelectionSpec`) is genuinely open — a new team-sport or player-pair sport with moneyline/spread/total markets can plug into the registry with no schema change (NFL and tennis both did exactly this). Adding **props** for any sport other than MLB, or a **market type** that isn't ml/spread/total, requires a Prisma migration regardless of how clean the adapter code is.

---

## 10. Functions that report success while potentially storing no usable data

**Systemic pattern: every adapter's `ingest()` wrapper hardcodes `ok: true` regardless of what actually happened underneath.**

- `src/lib/engine/adapters/nfl.ts:33-41` — `ingest()` returns `ok: true` even if `pollAndStoreNflOdds()` stored zero games (e.g. provider key expired, all events filtered out as non-NFL/CFL per `nfl/ingest.ts:140-145`, or a bye week).
- `src/lib/engine/adapters/soccer.ts:22-30` — same pattern; `pollAndStoreSoccerOdds()` can return `matchesStored: 0` (e.g. `resolveActiveSoccerSportKey()` finds no allowlisted tournament in season, `soccer/ingest.ts:103-113`) and `ingest()` still reports `ok: true`.
- `src/lib/engine/adapters/tennis.ts:104-112` — same pattern; `pollAndStoreTennisOdds()` returns zero matches when no allowlisted tournament is active, still `ok: true`.
- `src/lib/engine/adapters/f1.ts:21-30` and `src/lib/engine/adapters/mlb.ts:305-317` and `src/lib/engine/adapters/ufc.ts:195-205` — same shape: `ok: true` is a literal, never computed from the summary counts each `ingest()` returns.

None of these adapters check `summary.gamesStored`/`matchesStored`/`eventsFetched`/`racesUpserted` before deciding `ok`. `IngestSummary.ok` (`src/lib/engine/types.ts:122-127`) is typed as a real boolean, inviting a caller to trust it, but no adapter's `ingest()` ever computes it — it's dead weight that always reads `true`. A caller (e.g. a future ops dashboard, or a person watching `/api/status`) checking `ok` to decide "did today's ingest work?" would get a false positive on every zero-result run.

**Contrast:** the *odds-poll cron routes themselves* (as opposed to the adapter `ingest()` wrappers) mostly do this correctly — `writeOutcomeStatus` (used throughout `sync-results-nfl/route.ts:26`, `sync-results-tennis/route.ts:33-34`, `poll-player-props/route.ts:56`) explicitly distinguishes "nothing to do" from "fetched N, stored 0" and logs the latter as an error state in `PollLog`, which is exactly the discipline the adapter-level `ingest()` functions lack. `sync-results-nfl/route.ts:26-27`'s own comment even names this failure mode directly: *"Completed results fetched but nothing graded means every one failed to match a Game row — the exact silent failure mode that let tennis 'succeed' for weeks while grading nothing"* — i.e., this exact class of bug has already happened once in this codebase's history (for tennis's grading path) and was fixed there, but the same discipline was never applied to the six `ingest()` wrappers above.

**`grade-outcomes` cron (§6)** is the clearest current instance of "reports success but may store nothing": the route itself is correct and reports errors when invoked, but because it depends solely on a GitHub Actions `schedule:` trigger this project's own commits document as having silently failed to fire before, the *system* can silently stop writing MLB `GameOutcome` rows (feeding hit-rate stats via `src/lib/queries/hitRate.ts:68,104,141,145,149`) with no error surfaced anywhere, because there's no error — the job just never ran.

---

## 11. Stale documentation/branding describing ARCHR as MLB-only

- **`README.md:3`** — *"An MLB odds line-shopping tool: pick a price range with a slider..."* This is the entire project's public description, and it is six sports out of date. It mentions only The Odds API and MLB Stats API as data sources (line 11) — no OddsBlaze, Parlay, Cito, ESPN, or Jolpica. It never mentions Discord, the sport-engine registry, UFC, tennis, soccer, NFL, or F1 anywhere in the file.
- **`README.md:36-42`** — describes exactly **three** GitHub Actions workflows (`sync-schedule.yml`, `sync-free.yml`, `poll-odds.yml`) as the entire automation surface. There are actually **nine** workflow files and **fifteen** Vercel cron entries (§6); the README's automation section predates the Vercel Cron migration entirely.
- **`prisma/schema.prisma:1`** — `// Prisma schema for archer-odds-tool (v1: MLB game lines only)`, unchanged since before NFL/UFC/tennis/soccer/F1 tables existed in the same file.
- **`src/lib/engine/registry.ts:9-10`** — as noted in §2, still describes NFL/tennis as `signalOnly` after that was cleared.
- **Contrast with current live branding:** the app's own `<title>`/OpenGraph metadata already reads *"ARCHR Edge — every-sport odds, model leans & EV"* (`src/app/layout.tsx:33-49`), and the Discord embed author is `"ARCHR Edge"` (`src/lib/discord/brand.ts:17`) — the product itself has already rebranded as an every-sport platform; only `README.md` and the schema header comment still describe the old MLB-only framing. This is the clearest evidence that the docs, not the app, are the thing that's behind.

---

## 12. What can operate without a paid odds API

- **Install, typecheck, lint, build, and the entire 429-test unit suite** — confirmed in this audit, no external network calls or paid keys involved.
- **Local dev DB** — `docker compose up -d` + `npx prisma migrate dev` per `CLAUDE.md` (not verified live in this audit — see §13).
- **MLB schedule/scores/pitchers/lineups/boxscores** — MLB Stats API, free/unkeyed.
- **NFL and tennis results/settlement** — ESPN's free scoreboard, unkeyed.
- **F1 schedule and race results** — Jolpica API, free/unkeyed (`f1/jolpicaApiClient.ts:1-9`).
- **Soccer model inputs** — `footballData.ts`, no key referenced in code.
- **The Odds API on its free tier** — `.env.example:3-4` states a free-tier `ODDS_API_KEY` "works for local dev/testing," which is the default provider absent `PARLAY_API_KEY`/`ODDS_PROVIDER` (`oddsApiClient.ts:22-24`) — so basic game-line odds polling for every sport is reachable without a paid subscription, at free-tier rate/volume limits.
- **All backtests/calibration scripts** (`npm run backtest:*`) run against already-imported historical data (Sackmann tennis archive, stored `PlayerGameLog`/`UfcBout` history) — no live API calls.

## 13. What cannot operate without external credentials or live data

- **Pinnacle-anchored de-vig pricing and player-prop polling at production cost/volume** — requires `PARLAY_API_KEY` (paid); without it the app falls back to TOA, which per `oddsApiClient.ts:6-10`'s own comment carries no sharp book.
- **UFC fighter/event/results ingestion** — requires `CITO_API_KEY` (paid, 500 calls/month free tier per code comments); with no key, `syncRecentUfcEvents`/`backfillUpcomingUfcEvents` (and therefore the entire UFC adapter's `ingest`) cannot run.
- **Any Discord posting** — requires at minimum `DISCORD_WEBHOOK_URL`; without it the poster is fully dormant by design (§7), which is a safe default but does mean the "capper product" (per `postCard.ts:10`) doesn't exist without that credential.
- **Discord slash commands** (`/value`) — requires `DISCORD_PUBLIC_KEY`.
- **OddsBlaze routing for any sport** — requires `ODDSBLAZE_API_KEY` plus the relevant `*_ODDS_PROVIDER=oddsblaze` override; off by default (§5).
- **Production cron execution at all** — every `/api/cron/*` and `/api/admin/*` route 500s/401s without `CRON_SECRET` configured (`cronAuth.ts:1-14`), and (per §6) `grade-outcomes` additionally depends on GitHub Actions repo secrets `APP_URL`/`CRON_SECRET` being correctly configured, since it has no Vercel Cron entry.
- **A real Postgres instance** — `DATABASE_URL`; nothing that touches `prisma.*` runs without it (this includes every ingest, every cron, every DB-backed API route, and `npx prisma migrate dev`/`prisma studio`).

---

## What could not be verified

This audit was performed by static inspection of the repository plus running the four requested local commands. The following were **not** verified and should not be assumed true or false from this document alone:

- **Whether GitHub Actions' `sync-free.yml` is actually enabled and its `APP_URL`/`CRON_SECRET` repo secrets are currently set correctly** — §6/§10's `grade-outcomes` finding is based on reading the workflow file and the project's own prior incident comments, not on querying GitHub's Actions API or the live repo's secret configuration, which this audit had no access to.
- **Live behavior of `/api/status`, `PollLog` contents, or whether `grade-outcomes`/any other job is currently stale in production** — no production database or deployment was queried; `/api/status`'s existence and mechanism were confirmed by reading `src/app/api/status/route.ts`, not by calling it.
- **Whether `npx prisma migrate dev` / local Postgres via `docker compose up -d` actually succeeds** — Docker was not running during this audit (`docker ps` returned no containers) and this was not exercised; only `prisma generate` (schema→client codegen, no DB connection required) was run and confirmed.
- **Contents of the 23 npm audit vulnerabilities** (8 moderate/14 high/1 critical) reported by `npm ci` — not investigated (`npm audit` was not run), per the instruction not to fix anything yet.
- **Whether the Prisma 7→8 major-version upgrade notice printed by `prisma generate`** has any bearing on current behavior — noted but not investigated, since upgrades are out of scope for this audit.
- **Whether `PLAYER_PROPS_ODDS_ENABLED`, per-sport `*_ODDS_PROVIDER` overrides, or `ODDS_PROVIDER` are set in any real deployment** — only their existence and effect in code were confirmed.
- **The actual content/correctness of `docs/architecture/{calibration,nfl-adapter,props-matchup,provider-coverage}.md` and `docs/discord/*.md`** — these were referenced for corroboration (e.g. `sport-engine.md`'s "four disagreeing registries" history) but not exhaustively cross-checked line-by-line against current code for staleness beyond what's cited above.

---

## Severity-ranked issue table

**P0 (prevents installation, tests, build, or safe local operation): none found.** `npm ci`, `prisma generate`, `npm test`, `npm run typecheck`, and `npm run build` all pass cleanly on this branch with zero code changes (§1) — independently re-run three times during this audit (main pass plus two verification subagents), with identical results each time (429/429 tests, same 2 lint errors).

| # | Sev | Issue | Evidence |
|---|---|---|---|
| 1 | **P1** | MLB game-line settlement (`GameOutcome`, which feeds the hit-rate stats README.md advertises as a headline feature) depends entirely on the `grade-outcomes` cron, which has **no Vercel Cron entry** and relies solely on a GitHub Actions `schedule:` trigger — a mechanism this same codebase's commit history documents as having silently failed to fire for a full day+ before, on three other jobs that were subsequently migrated away from it. | `vercel.json` (no `grade-outcomes` entry); `.github/workflows/sync-free.yml:1-11`; `.github/workflows/poll-odds.yml:1-8`; `.github/workflows/sync-schedule.yml:1-5`; `src/lib/queries/hitRate.ts:68,104` |
| 2 | **P1** | The model-trust gate (`isModelTrusted`/`modelCalibration`, `src/lib/engine/trust.ts`) is fully implemented but called nowhere — MLB's model, whose own baked calibration verdict is `"marginal"` (Brier ≈ base rate, i.e. no measured edge), still posts every `modelEv > 0` play to the board and the tracked ledger with no gate suppressing it. | `src/lib/engine/trust.ts:10-30`; `src/lib/engine/adapters/mlb.ts:177-189,241-248,319-322`; zero call sites for `isModelTrusted` outside its own file |
| 2b | **P1** | Tennis's adapter documents at length that its Elo model's own CLV backtest shows it **loses** to modern closing lines and states its output is "SIGNAL-ONLY, never auto-posted as +EV picks" — but `excludeSignalOnly` (the only code-level filter gating auto-posting) checks `meta.signalOnly`, a *gradability* flag now `false` for tennis, not a profitability/trust flag. In practice a positive-EV tennis play is automatically posted to the unstaked `#ev-slate` channel with no code distinguishing it from any other sport's signal; only the owner's manual pick in `/deck` (`CardSelection`) stands between it and becoming a staked, tracked pick — there is no automated enforcement of the comment's claim. | `src/lib/engine/adapters/tennis.ts:36-46`; `src/lib/discord/postCard.ts:229-244,459` ("#ev-slate ... NOT recorded"); `src/lib/engine/trust.ts` (unwired, same root cause as #2) |
| 3 | **P1** | Every adapter's `ingest()` hardcodes `ok: true` regardless of the underlying fetch/store result, so a zero-result ingest (expired key, empty allowlisted tournament, filtered-out events) is indistinguishable from a successful one to any caller trusting `IngestSummary.ok`. | `src/lib/engine/adapters/{mlb,nfl,ufc,tennis,soccer,f1}.ts` (`ok: true` literal in each `ingest()`); contrast with the correctly-implemented `writeOutcomeStatus` pattern in `sync-results-nfl/route.ts:26-27`, whose own comment names this exact failure class from tennis's grading history |
| 4 | **P2** | The props subsystem (`PlayerPropSnapshot`, `CurrentPlayerPropLine`, `PostedPlay.mlbPlayerId`/`statCategory`) is hardwired at the **schema** level to `MlbPlayer` and the closed `StatCategory` enum — contradicting `PropSpec`'s own docstring claim of being "the door to every prop in every sport." Adding a prop for any non-MLB sport requires a Prisma migration, not just an adapter change. | `prisma/schema.prisma:286-297,439-480,530-560`; `src/lib/engine/types.ts:136-145` |
| 5 | **P2** | Several closed enums/unions (`MarketType` = h2h/spreads/totals only, `MarketKind` = ml/spread/total/prop only, `Sport` enum excludes `f1` entirely) block representing markets that don't fit team-sport moneyline/spread/total (F1 podium, boxing method-of-victory, golf top-N, etc.) without a schema/type change. | `prisma/schema.prisma:13-17,50-56`; `src/lib/queries/oddsPool.ts:32` |
| 6 | **P2** | Shared, generic-sounding modules are secretly MLB-only or MLB/tennis/soccer-only by hardcoded sport filters, making it easy to "plug in" a new sport at the adapter layer while missing that a shared query it depends on silently excludes it. | `src/lib/queries/games.ts:28-30,60,146,168`; `src/lib/queries/oddsPool.ts:249`; `src/lib/grading/gradeOutcomes.ts:80,134-135` |
| 7 | **P3** | `README.md` describes ARCHR as an MLB-only tool with three GitHub Actions workflows and two free data sources; the actual app already brands itself "ARCHR Edge — every-sport odds, model leans & EV," has 6 sports, 15 cron routes, 9 workflows, and 7+ external data sources. | `README.md:3,11,36-42`; `src/app/layout.tsx:33-49`; `src/lib/discord/brand.ts:17` |
| 8 | **P3** | `.env.example` documents 7 of ~20 environment variables actually read by the app (missing `PARLAY_API_KEY`, `ODDSBLAZE_API_KEY`, `ODDS_PROVIDER`, all 5 per-sport `*_ODDS_PROVIDER` vars, `CITO_API_KEY`, `PLAYER_PROPS_ODDS_ENABLED`, `DISCORD_SLATE_WEBHOOK_URL`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_GUILD_ID`), making several subsystems (UFC, per-sport OddsBlaze routing, props polling, 3 of 4 Discord channels, slash commands) undiscoverable from onboarding docs alone. | `.env.example:1-23` vs. citations in §5 |
| 9 | **P3** | Two stale/inconsistent doc comments found inline in otherwise-current code: `registry.ts` still describes a cleared `signalOnly` state for NFL/tennis; `prisma/schema.prisma`'s file header still says "v1: MLB game lines only" despite housing 5 additional sports' tables. | `src/lib/engine/registry.ts:9-10` vs. `src/lib/engine/sportsMeta.ts:25,27-29`; `prisma/schema.prisma:1` |
| 10 | **P3** | `eslint` reports 2 errors (`no-explicit-any`) and 6 warnings (`no-unused-vars`), all confined to scripts/dev-tooling and unused imports, none in a hot runtime path. | `scripts/providers/probe.ts:205,258`; see full list in §1 |
| 11 | **P3** | `npm ci` reports 23 dependency vulnerabilities (8 moderate, 14 high, 1 critical) — not triaged in this audit per scope, but should be reviewed before any further dependency work. | `npm ci` output |

---

## Step 2 remediation — truthful ingestion

**Branch:** `recovery/platform-baseline`. Addresses P1 issue #3 (every adapter's `ingest()` hardcoding `ok: true`) and the `poll-odds-soccer`/`poll-odds-tennis` half of P1 issue #1's failure class. No sports added, no providers changed, no schema migration, no odds/model math touched, nothing committed/pushed.

**Two parallel ingestion paths exist, and this pass improved both without unifying them.** As established at the top of this task and re-confirmed by the adversarial review below (`grep -rn "\.ingest(" src scripts` excluding adapter definitions and tests, zero hits): **`SportAdapter.ingest()` is not called anywhere in production.** Every cron route invokes the underlying `sync*`/`pollAndStore*`/`gradeUngradedGames` functions directly. So there are genuinely two separate call paths into the same underlying data:

1. **The live path** — cron routes (`src/app/api/cron/*/route.ts`) calling library functions directly. This is what Vercel Cron and GitHub Actions actually invoke, and it's where the audit's real production risk lived.
2. **The dead path** — `SportAdapter.ingest()` (`src/lib/engine/adapters/*.ts`), part of the documented sport-engine contract, called by nothing today except this task's own instructions to fix it, plus this file's own future readers who might assume the registry is production's ingestion entry point.

Step 2 rewrote both paths to use the same `IngestSummary`/`classifyFetchStore` contract, but it did **not** make the routes call the adapters (that would be a materially larger refactor — routes bundle cadence/credit-guardrail/self-heal logic the adapters don't have — and was out of this task's "smallest coherent change" scope). A reader of this document should not conclude that fixing the adapter contract fixed production behavior; the route-level fixes (§"What changed, per path" below) are what actually changed anything a live deployment does. Fixing the adapters was still worth doing on its own terms — the type is the documented engine contract, and a future caller (or a refactor that finally wires the registry into cron) would otherwise inherit the same `ok: true` lie.

**No live deployment behavior was verified anywhere in this task or its review.** Every command run (`npx prisma generate`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`) is local/static. No `.env` file, no running Postgres, and no network calls to any odds provider, Cito, Jolpica, ESPN, or Discord were made at any point — consistent with the constraint not to call live APIs. Everything in this section is a claim about what the *code* now does, verified by reading it and by the unit tests in `src/lib/engine/ingestResult.test.ts`; none of it has been observed running against a real deployment, a real GitHub Actions run, or a real Vercel Cron invocation.

### The contract

`IngestSummary` (`src/lib/engine/types.ts`) now carries a `status: IngestStatus` — `"ok" | "empty" | "skipped" | "unusable" | "error"` — instead of an unconditional `ok: boolean`. `ok` still exists (derived: true for `ok`/`empty`, false otherwise) so nothing reading the old field breaks, but truthfulness now lives in `status`:

| status | means | HTTP (cron routes) |
|---|---|---|
| `ok` | usable records fetched **and** stored | 200 |
| `empty` | ran fine; provider legitimately had nothing (off-season, no active tournament, nothing left to grade) | 200 |
| `skipped` | did not run — disabled by a flag, or credentials absent | 200 |
| `unusable` | provider responded (no throw) but **zero** usable records came of it — the case a bare `ok: true` used to hide | 502 |
| `error` | the attempt threw; `detail` is a sanitized, secret-free message | 502 |

A new shared module, `src/lib/engine/ingestResult.ts`, is the one place this logic lives:
- `classifyFetchStore({fetched, stored, rejected}, {noun, emptyDetail?})` — `fetched === 0` → `empty`; `fetched > 0 && stored === 0` → `unusable`; else `ok`. Every adapter/route maps its own summary's fields onto `fetched`/`stored` first (field names differ per sport — see below).
- `summaryForCaughtError(sportKey, error)` — classifies a caught error as `skipped` (matches this codebase's own existing `"<VAR>_API_KEY is not set"` throws from `oddsApiClient.ts`/`citoApiClient.ts`) or `error`, after running the message through `sanitizeErrorMessage` (strips `?apiKey=...`/`&token=...`-shaped query-string values, caps length at 300 chars) — never logs or returns a raw provider error body unfiltered.
- `ingestHttpStatus(status)` / `pollLogStatus(summary)` — the non-2xx-for-genuine-failure HTTP mapping and a PollLog-text formatter that keeps the pre-existing `"error:"` prefix convention `writeOutcomeStatus` established (`/api/status` greps for it — see `writeOutcomeStatus.test.ts`).

`pollingPolicy.ts`'s `writeOutcomeStatus` was deliberately left untouched — its exact output strings are locked in by an existing test and it already implements the same `ok`/`empty`/`unusable` distinction for the 5 routes that used it correctly before this change; those routes keep calling it for PollLog text and additionally surface the new `status` field.

### What changed, per path

**Adapters (`src/lib/engine/adapters/*.ts`)** — all 6 rewritten to classify instead of hardcoding `ok: true`, and to catch their own thrown errors (previously the promise just rejected; now `ingest()` always resolves to a summary, per its documented contract):
- **MLB** — classifies on games fetched (new `SyncScheduleSummary.gamesFetched`, added alongside the existing `gamesUpserted`) vs. upserted.
- **NFL** — classifies on `eventsFetched` vs. `gamesStored` (fields already existed).
- **UFC** — classifies via `classifyUfcIngest`, not the generic `classifyFetchStore`: events and bouts are different units (an event's processed-counter increments *before* its bouts are even looked at, so "events > 0, bouts stored === 0" is the ordinary shape of an event whose card isn't announced yet), so `unusable` requires `rejected > 0` — real evidence a bout entry existed and was missing corner data — not just a zero bout count. Zero new events is treated as the *normal* outcome (the sync deliberately stops at the first already-settled event), not empty-as-failure. (This distinction was tightened during the adversarial review below — see that section.)
- **Tennis / Soccer** — `sportKeyPolled === null` (no allowlisted tournament/competition active) short-circuits straight to `empty` with a specific detail, ahead of the generic fetched/stored check.
- **F1** — classifies on races fetched (new `F1ScheduleSummary.racesFetched`) vs. upserted.

**`grade-outcomes` cron** (the audit's P1 #1 — MLB's only writer of game-line `GameOutcome` rows): `gradeUngradedGames()` previously returned `ungraded.length` — "games we attempted to grade," not "games we actually wrote outcomes for." It now returns `{considered, graded}`; `gradeGame()` now returns the count of `GameOutcome` rows it wrote (0 if it bailed early) instead of `void`. The route classifies on `considered` vs. `graded`, so "0 ungraded games right now" (the common case on a 15-minute cadence) reads as `empty`, while "found ungraded final games but wrote outcomes for none of them" — which should not be possible for a `status: "final"` MLB row — now reads as `unusable` and a 502, instead of a silent `"ok"`. (This does not fix the separate, still-open scheduling problem that this cron has no Vercel Cron entry — see P1 #1 above; it only fixes what the route reports when it *does* run.)

**`poll-odds-soccer` / `poll-odds-tennis`** (named explicitly in the audit): previously `recordPollLog(JOB_NAME, "ok", ...)` unconditionally. Now classify on `eventsFetched`/`matchesStored`, with the `sportKeyPolled === null` short-circuit for "no active tournament/competition" → `empty`.

**`sync-schedule`**: previously logged `"ok"` regardless of `gamesUpserted`. Now classifies on the new `gamesFetched` vs. `gamesUpserted`.

**`backfill-ufc` / `backfill-player-game-logs`**: already logged real counts in the text, but unconditionally and with an always-200 response; now classify properly and return 502 on `unusable`/`error`.

**`backfill-f1`**: see "still cannot distinguish" below — deliberately classifies only on `racesProcessed` (never claims `unusable`), because its write path is idempotent (`skipDuplicates`) and a healthy daily re-run over already-backfilled seasons routinely writes zero *new* rows, which is not a failure.

**Light-touch routes** (`poll-odds`, `poll-odds-nfl`, `poll-player-props`, `sync-results-nfl`, `sync-results-tennis`): these already used `writeOutcomeStatus` and logged truthful PollLog text. Their PollLog calls and control flow are unchanged; each now additionally (a) surfaces a `status` field in its JSON response instead of an unconditional `ok: true`, and (b) returns the same 502-on-`unusable` HTTP status the newly-fixed routes return, closing a gap where the PollLog said `"error: ..."` but the HTTP response still came back 200.

**`scripts/providers/probe.ts`**: the two `no-explicit-any` errors (lines 205, 258 pre-change) are fixed with two small local interfaces (`ProbeOddsEvent`, `ProbeExtraRow`) describing just the fields the script reads — behavior-identical, no other warnings touched.

### Tests

`src/lib/engine/ingestResult.test.ts` (31 cases after the adversarial-review additions) covers all five states plus the cross-cutting rules: usable records stored → `ok`; a verified empty slate → `empty` (including the custom "no active tournament" detail); provider returns events but stores none → `unusable` (never an ordinary success); a caught `"..._API_KEY is not set"` error → `skipped`; any other caught error → `error`, with secrets (query-string keys and `Authorization`/`Bearer` values) redacted from the message. A dedicated `"route-level HTTP composition"` block composes the classifier output with `ingestHttpStatus` exactly as every route does — proving a thrown error can never compose to 200, a legitimate empty slate composes to 200, an `unusable` outcome composes to 502, and a `skipped` run composes to 200 distinctly from `empty` — plus `ingestHttpStatus` now asserts the exact codes (200/502), not just "not 200". `classifyUfcIngest` has its own block, including the exact false-positive regression case found in review (events processed with zero bouts and zero rejections must read `ok`, not `unusable`).

No adapter-level or route-level DB-mocked tests were added — this codebase has no existing `vi.mock` usage anywhere (every test file exercises pure functions only), so adding one would be a testing-convention change beyond this task's scope. Since every adapter's `ingest()` and every cron route's success/catch path routes its status decision through this same shared, now-thoroughly-tested classifier — never constructing its own ad hoc status logic — the composed tests above are the closest verification of "production route behavior" achievable without introducing DB/network mocking for the first time in this codebase.

### Paths that still cannot fully distinguish "empty" from "bad data"

- **`backfill-f1`** — `resultsWritten` is not a reliable success signal on its own: the write path is idempotent (`createMany` + `skipDuplicates`), so a normal daily re-run over seasons that already have their results stored writes 0 *new* rows every time. This route currently classifies only on `racesProcessed` (did Jolpica return anything at all) and never reports `unusable`, so a scenario where Jolpica returns races but something silently fails to construct valid result rows (a shape change, for instance) would still read as `ok`. Fixing this properly would require the write path itself to report matched-vs-written counts distinctly from the dedup outcome, which touches data-writing logic beyond this task's "smallest coherent change" scope.
- **UFC's `ingest()`/`backfill-ufc`** — `classifyUfcIngest` (added during the adversarial review) requires `rejected > 0` before reporting `unusable`, which is real evidence (a bout entry existed and was unresolvable), not a guess. What it still can't detect: a Cito response shape change that causes bouts to silently parse as zero *without* tripping the `skippedBouts` path at all (e.g. a renamed field that makes `citoEvent.bouts` read as `undefined` for every event) — that would still read as a benign zero-bout event, not `unusable`, because there'd be no rejection evidence either. Same class of blind spot as `backfill-f1` below.
- **`sync-results` (the bundled MLB self-heal cron)** was not touched — it fans out into ~7 independent sub-operations (schedule sync, pitchers, lineups, poll-odds self-heal, game logs, stranded-game heal, preseason purge, UFC-upcoming self-heal), each already with its own `recordPollLog` call and reasonable text, but none using the new structured `status` contract. Left out of this pass as a materially larger, higher-risk refactor than the routes above; flagged here rather than silently left inconsistent.

### Adversarial review of this change (same branch, before commit)

A full-diff adversarial pass was run against the working tree above (`git diff`, all 23 modified + 3 new files) before accepting it. Two concrete defects were found and fixed in place (not deferred):

1. **UFC fetched/stored unit mismatch could produce a false `unusable`.** The original UFC classification reused the generic `classifyFetchStore` on `{fetched: eventsProcessed, stored: boutsProcessed}`. `backfillUfc.ts`'s `ingestEvent` increments `eventsProcessed` *before* it ever looks at that event's bouts, so an event whose fight card simply hasn't been announced yet (`citoEvent.bouts` empty) would legitimately produce `eventsProcessed > 0, boutsProcessed === 0, rejected === 0` — and the old logic would report that as `unusable` (502) with no failure having occurred. Fixed by adding `classifyUfcIngest` (`src/lib/engine/ingestResult.ts`), which requires `rejected > 0` — real evidence a bout entry existed and couldn't be resolved — before reporting `unusable`; a zero-bout event with zero rejections now reads `ok`. Applied to both `ufc.ts`'s adapter and `backfill-ufc/route.ts`. Regression test: `classifyUfcIngest` → `"does NOT report unusable for an event with no bouts announced yet"`.
2. **Inconsistent secret redaction across cron routes.** `sanitizeErrorMessage` (added in the original Step 2 pass) was only reached via `summaryForCaughtError`, which the 7 fully-rewritten routes use — the 5 "light-touch" routes (`poll-odds`, `poll-odds-nfl`, `poll-player-props`, `sync-results-nfl`, `sync-results-tennis`) keep their pre-existing `error instanceof Error ? error.message : String(error)` extraction, unsanitized. Fixed by wrapping that same extraction in `sanitizeErrorMessage` in all 5 — a message-only change, no control-flow, HTTP-status, or PollLog-format change. `sanitizeErrorMessage` itself was also strengthened during this pass to redact `Authorization: Bearer <token>`/`authorization=<token>`-shaped values in addition to the query-string `?apiKey=...` pattern it already caught, with new tests for both.

Also corrected during this pass: the "68 total routes" claim in §1 was wrong (see that row's note) — the actual count, verified directly from a fresh build's printed route table, is 66.

**Findings considered and NOT changed, with reasoning:**
- **`skipped` covering "credentials absent"** (not just deliberate feature flags like `PLAYER_PROPS_ODDS_ENABLED`) means a missing required API key reads as a 200, "skipped:"-prefixed PollLog line rather than an "error:"-prefixed one — and this codebase's own convention (per `writeOutcomeStatus.test.ts`) is that status monitoring greps for the `"error:"` prefix specifically. A missing credential in production is a real, urgent misconfiguration, and grep-based monitoring tuned to "error:" would not surface it as urgently as a thrown error would. This was **not changed**, because "skipped/disabled because configuration or credentials are absent" was an explicit, named state in this task's own original instructions, and this review's own HTTP-semantics instructions confirm 2xx is correct for "intentional skipped/disabled operations." The behavior matches what was specified; the tradeoff is real and is recorded here rather than silently accepted.
- **The 5 "light-touch" routes' PollLog text and control flow** were left on `writeOutcomeStatus` rather than migrated to `pollLogStatus`, even though the two now produce slightly different string shapes for the same underlying state. `writeOutcomeStatus`'s exact output strings are locked in by an existing, passing test (`src/lib/writeOutcomeStatus.test.ts`); rewriting those 5 routes' logging to match `pollLogStatus` verbatim would be a style unification with no behavioral benefit, which this review's instructions explicitly say not to do ("do not refactor merely for style").
- **`decideFixedCadencePoll`/`decidePollOdds`'s "not due yet" early-return branches** (`if (!decision.shouldPoll) return Response.json({polled:false, ...decision})`) don't carry the new `status` field — they already carry `blockedReason: "not-due" | "low-credits" | null`, which is an equally explicit label, just under a different field name, and predates this task entirely (unchanged by Step 2 or this review). Flagged as a minor inconsistency, not fixed, to avoid touching decision-gate code that was never in scope.
