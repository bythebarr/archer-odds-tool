# Product integration & launch inventory

> Read-only inventory, produced 2026-09-21 on `recovery/platform-baseline` @
> `52aa8bc`. No application code, schema, migrations, formulas, UI, Discord,
> providers, cron schedules, or deployment configuration were changed to
> produce this document — only this file was written, and it is not yet
> committed. No test data was written to any database.

## 1. Current exact state

- **Branch:** `recovery/platform-baseline`
- **HEAD:** `52aa8bc3645d82b2d5798e9d93a5e8dac3f341c8`
- **Working tree:** clean except this new file
- **Divergence from `main`:** `main` is at `84b0aec` (unchanged). `recovery/platform-baseline` is a clean **fast-forward** ahead by 7 commits — `git merge-base main recovery/platform-baseline` equals `main`'s own HEAD, so there is no divergent history and nothing to reconcile if this branch is ever merged.
- **The 7 commits on this branch, absent from `main`** (newest first):

  | Commit | Summary |
  |---|---|
  | `52aa8bc` | Add experimental NFL research and forward prediction capture |
  | `4ada081` | Record experimental CFB predictions for forward testing |
  | `dd77b62` | Add immutable model prediction history foundation |
  | `9594702` | Fix CFB market state and feed validation |
  | `2e446e7` | Add experimental CFB research board |
  | `f8054a6` | Document the current MLB model and its validation gaps |
  | `a4b5734` | Report ingestion outcomes truthfully instead of always claiming success |

  Across all 7 commits combined: `vercel.json` **untouched** (no cron/build-command change), `.github/workflows/` **untouched**, `package.json` gained exactly one line (`capture:cfb:predictions`), `prisma/schema.prisma` gained one additive migration (`PredictionRun`/`ModelPrediction`, no existing table altered). Nothing about production deployment configuration changed anywhere in this branch's history.

## 2. Every app route

26 page routes exist under `src/app/` (via `find … -name page.tsx`):

```
/                       /cfb                    /deck
/f1                     /games/[gameId]         /learn
/mlb                    /nfl                    /nfl/[gameId]
/nfl/research           /preview/discord        /privacy
/props                  /props/[mlbPlayerId]    /props/board
/slate                  /slate/mlb              /soccer
/soccer/[matchId]       /sports                 /support
/support/inbox          /tennis                 /tennis/[matchId]
/terms                  /ufc                    /ufc/[boutId]
```

## Navigation entries (`src/lib/nav.ts`)

`NAV_ITEMS` = Home, Slate, **6 registry sports** (derived from `SPORT_METAS`, in registry order: MLB, NFL, UFC, Tennis, Soccer, F1), **CFB** (hand-appended, `/cfb`, explicitly documented as "TEMPORARY v0 debt" — not derived from the registry), Props, and a mobile-only "Sports" hub.

**`/nfl/research` has NO navigation entry anywhere** — reachable only via a small text link ("Experimental research →") added to `/nfl`'s own page header. This was deliberate, per that task's own constraint ("no UI changes... possibly adding a small link").

## 3. Every registered sport and `SportAdapter`

`src/lib/engine/registry.ts`'s `SPORTS` array — exactly 6 entries: `mlbAdapter`, `nflAdapter`, `ufcAdapter`, `tennisAdapter`, `soccerAdapter`, `f1Adapter`. **CFB has no adapter and is not in this array** — confirmed by CFB-V0.md's own explicit design ("CFB v0 is not registered in the sport engine... it never touches the graded-play pipeline") and by grep (zero references to `cfb` in `registry.ts`/`sportsMeta.ts`). NFL's research slice (`src/lib/nfl/research/`) also has no adapter and is not registered — it is architecturally isolated from the engine entirely (confirmed: no import of `@/lib/engine` anywhere under `src/lib/nfl/research/`).

## 4–5. Per-sport capability matrix

| Sport | Route | Schedule data | Live/stored market odds | Model probabilities | Margin/totals | Player props | Grading/results | Prediction-history capture | Research UI | Production UI | Discord eligible |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **MLB** | `/mlb` | ✅ (DB, MLB Stats API) | ✅ (paid, DB) | ✅ (Archer, `modelEv`) | ✅ (runs/spread/total) | ⚠️ ranked only, never priced (`modelEv` hardcoded `null` for props — MLB-MODEL-INVENTORY.md §1) | ✅ (`GameOutcome`, but sole writer `grade-outcomes` has **no Vercel Cron entry** — P1 in EDGE-BASELINE-AUDIT.md) | ❌ none | ❌ | ✅ full, model-priced board | ✅ posts every `modelEv>0` play (calibration verdict "marginal" — essentially no proven edge — is not gated) |
| **NFL (production)** | `/nfl` | ✅ (DB, paid feed) | ✅ (paid, DB) | ❌ (`nflAdapter.listPlays()` hardcoded `[]`; `NFL_MODEL` exists, deliberately not wired — nfl.ts's own docstring) | ❌ | ❌ | ✅ (ESPN free scoreboard, `results.ts`) | ❌ none | ❌ | ✅ line-shopping only, no model | ❌ empty board, nothing to post |
| **NFL (research)** | `/nfl/research` | ✅ (ESPN, live) | ❌ none stored server-side (manual, browser-only `localStorage`) | ✅ (`NflElo`, same model/constants as production's `NFL_MODEL`, calibration-trusted, **confirmed CLV-negative**) | ✅ expected margin only (no totals, no cover prob) | ❌ | ❌ (no settlement writer yet — deferred, documented) | ✅ `PredictionRun`/`ModelPrediction`, manual button, `lifecycle: experimental` | ✅ | — (deliberately separate from production `/nfl`) | ❌ no import path to Discord code at all |
| **CFB** | `/cfb` | ✅ (ESPN, live) | ❌ none stored server-side (manual, browser-only `localStorage`) | ✅ (`cfb-srs`, own opponent-adjusted SRS model, **never backtested**) | ✅ margin + total (values only; experimental cover/O-U probabilities ARE computed here, unlike NFL research — see CFB-V0.md "Model formula") | ❌ | ❌ (no DB at all by design) | ✅ `PredictionRun`/`ModelPrediction`, manual script (`npm run capture:cfb:predictions`), `lifecycle: experimental` | — (the whole page is framed as research) | — | ❌ not registered, no adapter, no import path to Discord |
| **UFC** | `/ufc` | ✅ (Cito, paid) | ❌ (fighter-math, not odds-driven the same way) | ✅ (fighter-math, calibration-trusted, n=1227) | n/a (moneyline sport) | ❌ | ✅ (`gradePlay`, settles fight results) | ❌ none | ❌ | ✅ full | ✅ posts, no CLV backtest exists for UFC (unlike tennis/soccer/NFL — not confirmed negative, just untested) |
| **Tennis** | `/tennis` | ✅ (paid feed) | ✅ (paid, DB) | ✅ (surface Elo, calibration-trusted, **confirmed CLV-negative**) | n/a | ❌ | ✅ (ESPN free scoreboard) | ❌ none | ❌ | ✅ modeled, priced within a believability band | ⚠️ flows to unstaked `#ev-slate`; staked card only via owner's manual `/deck` pick |
| **Soccer** | `/soccer` | ✅ (paid feed) | ✅ (paid, DB) | ❌ (`soccerAdapter.listPlays()` hardcoded `[]`; Poisson model exists, not wired) | ❌ | ❌ | ❌ (`grade` hardcoded `"void"` — never settles) | ❌ none | ❌ | ✅ line-shopping only, no model | ❌ empty board |
| **F1** | `/f1` | ✅ (Jolpica, free) | ❌ (no markets at all — `F1_MARKETS = []`) | ❌ | ❌ | ❌ | ✅ (season/race results only) | ❌ none | ❌ | ✅ results-only page | ❌ no markets to post |

**Additional surfaces, not per-sport:** `/props`/`/props/board` (MLB-only prop ranking, no pricing), `/slate` (registry-driven odds board, all 6 registered sports, CFB absent by construction), `/deck` (owner's daily card-selection UI, gated by `CRON_SECRET` token), `/sports` (mobile sport-hub, registry-driven, CFB absent).

## 6. What's in the two stashes (inspected, not applied)

### `stash@{0}` — "paused-mlb-closing-market-diagnostic" (2026-09-19)

**One file, one line:** adds a `backtest:mlb:clv` npm script to `package.json` pointing at `scripts/backtest-mlb-clv.ts` — **that script file does not exist anywhere** in the working tree (tracked, untracked, or ignored). This appears to be the very first step of wiring MLB's own CLV backtest (mirroring the existing `backtest:{tennis,soccer,nfl}:clv` scripts) — the npm-script wiring was added, the actual backtest script itself was never written before the work was paused. Per MLB-MODEL-INVENTORY.md §5, this is exactly the gap that document calls "the largest gap... a data-collection investment already made [`GameClosingLine`] and entirely unused" — this stash is unfinished work toward closing it, not related to CFB/NFL.

### `stash@{1}` — "paused-step-3-discord-trust" (2026-09-18)

**5 files, 266 insertions:** implements the missing half of the EDGE-BASELINE-AUDIT.md P1 finding that `isModelTrusted`/`src/lib/engine/trust.ts` is fully built but wired to nothing. Specifically:
- `src/lib/engine/index.ts` — exports a new `evaluatePlayTrust` function.
- `src/lib/discord/postCard.ts` (+70 lines) — a `withOverrideWarnings`-style mechanism that labels untrusted/ineligible plays at post time, re-deriving trust independently rather than trusting client input.
- `src/app/deck/actions.ts` (+24) / `src/app/deck/page.tsx` (+62) — the `/deck` UI gains a required "override acknowledgement" checkbox before an untrusted/model-ineligible play can be promoted onto the staked card/free-play stream (Policy #6 per the stash's own comment: "an untrusted selection must be unmistakably labeled before it can be posted or recorded").
- `docs/architecture/EDGE-BASELINE-AUDIT.md` (+118) — a "Step 3" remediation write-up appended to the same audit document already on `main`/this branch.

This is real, substantial, reviewed-looking work (has its own adversarial-review-style tradeoff notes inline) sitting paused, unrelated to CFB/NFL — it directly addresses this branch's OWN P1 finding about the trust gate being inert. **Not applied, not inspected further than reading the diff.**

## 7. Vercel configuration

- **Production branch:** not verifiable from this repository or session (no `.vercel/project.json`, Vercel CLI not authenticated — `vercel whoami` → `loggedIn: false`). Standard Vercel default assumed (`main`), not confirmed.
- **Build command:** `prisma migrate deploy && next build` (`vercel.json`, unchanged across all 7 commits) — identical for every deployment Vercel creates, Production or Preview. This means **any** deployment of this branch applies pending Prisma migrations (including the new `PredictionRun`/`ModelPrediction` tables) against whichever `DATABASE_URL` that deployment's environment scope resolves to.
- **Preview behavior:** Vercel's documented default (not independently re-verified this session) is that pushing any non-Production-Branch branch — including `recovery/platform-baseline` — triggers an automatic Preview deployment, and that Vercel Cron Jobs (53 entries in `vercel.json`, unchanged) fire only against the Production deployment, never Preview.
- **Required environment variables:** unchanged from the prior deployment-topology investigation this session — `DATABASE_URL` is the only one the new CFB/NFL-research work needs; everything else (`DISCORD_*`, `*_API_KEY`, `CRON_SECRET`) is either irrelevant to this new work or must be deliberately absent/distinct in a staging scope (see that investigation's full variable-by-variable table, not repeated here).
- **Database/migration requirements:** the new migration is purely additive (2 new tables, 1 new enum, zero `ALTER` on any existing table — confirmed via `prisma/migrations/20260921185430_add_model_prediction_history` and the follow-up regenerated `20260921192732_add_model_prediction_history`, both already reviewed in-session).
- **Whether the `PredictionRun` migration exists on the deployed database:** **unknown, not verifiable from this session** — no access to any deployed Vercel project, its environment variables, or its database. This is the single most important unknown for actually using this work anywhere but locally.

## 8. Why the owner's current live app does not expose the recently built CFB/NFL work

Three independent, sufficient reasons, in order of how far upstream they sit:

1. **`main` doesn't have any of it.** All 7 commits — CFB v0, the prediction-history foundation, CFB capture, and NFL research — exist only on `recovery/platform-baseline`. If the live app deploys from `main` (the presumed, unverified default), none of this code has ever been part of a production build, regardless of any other factor.
2. **Even on this branch, both features are deliberately unwired from the primary product surface.** CFB is a hand-appended nav link outside the sport registry (CFB-V0.md's own documented "temporary v0 debt"); NFL research has no nav entry at all, only a small link from `/nfl`. This was an explicit constraint in every task that built this work ("no UI changes," "CFB joins the registry only after a full adapter/storage/grading strategy... is approved").
3. **No production database or Discord path exists for either.** Both write only to the new, generic `PredictionRun`/`ModelPrediction` tables, which nothing else in the app reads yet — there is no dashboard, no Discord post, no `/deck` integration for this data, by design (every task explicitly forbade it).

None of these are accidents or blockers to fix — they're the deliberate shape of "build the vertical slice, prove it works, keep it isolated" that every task in this sequence asked for.

## 9. Whether `/nfl/research` is reachable right now, and exactly how to open it

**Two separate things, not to be confused:**

- **This Codespace's own local dev server** — confirmed running right now (`next dev`, PID `124993`/`next-server`, listening on `:3000`, verified via `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/nfl/research` → `200`). Reachable from outside the Codespace at:

  **`https://musical-yodel-qvvv69gx4w7p367wq-3000.app.github.dev/nfl/research`**

  (Codespaces' standard forwarding pattern: `https://<codespace-name>-<port>.app.github.dev`, where `<codespace-name>` = `$CODESPACE_NAME` = `musical-yodel-qvvv69gx4w7p367wq`, confirmed from this session's own environment.) If VS Code's Ports panel hasn't already forwarded/made port 3000 public, open it there first — Codespaces auto-forwards a port the moment a server binds it, but visibility (private vs. public) may need a manual toggle in the Ports tab.

- **A real Vercel branch preview for `recovery/platform-baseline`** — **cannot be confirmed from this session.** No `.vercel/project.json` exists locally (this checkout was never linked to a Vercel project), and the Vercel CLI here is unauthenticated. Whether such a preview exists, what URL it has, and whether it shares `DATABASE_URL` with production are all unknowns requiring the Vercel dashboard directly (same unknowns already flagged in the prior deployment-topology investigation this session).

## What the owner can experience today

- Locally, right now, via the Codespace URL above: `/nfl/research` end to end, including clicking "Record prediction snapshot" against the local dev Postgres (confirmed working with real data in the prior task).
- Also locally: `/cfb` (the research board) and `npm run capture:cfb:predictions` from a terminal.
- On `main`/production (if that's what's actually deployed): none of the above — only the pre-existing MLB/NFL/UFC/Tennis/Soccer/F1 product, unchanged.

## What exists but is hidden

- CFB (`/cfb`) — built, real ESPN data, no nav entry (hand-linked debt, documented).
- NFL research (`/nfl/research`) — built, real ESPN/nflverse data, no nav entry, linked only from `/nfl`'s own page.
- The generic prediction-history foundation itself (`PredictionRun`/`ModelPrediction`) — nothing in the app reads it; it's pure write-side infrastructure today.

## What is committed but not deployed

All 7 commits on `recovery/platform-baseline`, entirely — see §1. Nothing here is on `main`.

## What is stashed

Two paused efforts, neither related to CFB/NFL — see §6: an MLB CLV-backtest npm-script stub with no script file behind it yet, and a substantial, close-to-finished "wire the model-trust gate into what actually posts to Discord" change.

## What is documentation only

Nothing new in this task — every doc this branch added (`CFB-V0.md`, `MLB-MODEL-INVENTORY.md`, `MODEL-PREDICTION-LIFECYCLE.md`, `MODEL-DATA-REQUIREMENTS.md`, `NFL-RESEARCH.md`) documents code that was actually built and, in CFB/NFL's case, actually run against real data and verified in this session. The one genuinely documentation-only item on the whole branch is `f8054a6`'s MLB model inventory audit — it changed no code, only wrote the audit.

## What must not be presented as validated

- **CFB's model** — explicitly never backtested against historical closing lines (CFB-V0.md's own "Non-goals").
- **NFL's Elo model** (production or research) — calibration-trusted but **confirmed CLV-negative** (loses to the closing line: −3.38% to −7.97% ROI depending on market/window, per `calibration.md`).
- **Tennis and soccer's models** — same shape: calibration-trusted, confirmed CLV-negative.
- **MLB's model** — calibration verdict is "marginal" (essentially no proven edge over a coin flip), and MLB has **never** had a CLV backtest run at all (the largest single gap MLB-MODEL-INVENTORY.md identifies).
- **Any `ModelPrediction` row with `lifecycle: "experimental"`** (every row either writer produces today) — by the generic foundation's own design, this label must never be silently upgraded.

## The smallest safe integration sequence for one unified cross-sport preview

1. **Confirm the Vercel Production Branch setting** on the dashboard (§7's biggest unknown) — this determines whether merging to `main` is even the right lever to pull, or whether a preview already exists.
2. **Provision (or confirm) a staging database**, distinct from production's `DATABASE_URL`, scoped to Preview only — per the prior deployment-topology investigation's full sequence; not repeated here.
3. **Deploy `recovery/platform-baseline` as a Preview** (a plain `git push`, already done) against that staging database, and confirm in the build log that `prisma migrate deploy` reports connecting to the staging database, not production.
4. **Add nav entries for `/cfb` and `/nfl/research`** — the smallest possible UI change that makes both actually discoverable, gated behind whatever access control the staging deployment uses (`SITE_ACCESS_PASSWORD`). This is the first UI change any task in this sequence has deliberately deferred; it's additive (two more `NAV_ITEMS` entries) and touches no existing sport's presentation.
5. **Run one real forward capture of each** (`npm run capture:cfb:predictions`, then a click of "Record prediction snapshot" on `/nfl/research`) against the staging database, so the preview has real data to show, not an empty state.
6. **Do not merge to `main` or touch production `DATABASE_URL`/Discord webhooks at any point in this sequence** — the preview is the deliverable, not a production launch.

## Proposed navigation structure for the preview

Minimal, additive, does not reorder or relabel any existing tab:

```
Home · Slate · MLB · NFL · UFC · Tennis · Soccer · F1 · CFB · Props · [Sports hub, mobile]
                 └─ "Research →" link to /nfl/research (as already built)
```
Plus one new top-level entry, positioned next to CFB (both are the "experimental, not-yet-registry" tier):
```
… · CFB · NFL Research · Props · …
```
A single new `NAV_ITEMS` entry (`{ href: "/nfl/research", label: "NFL Research", icon: "🧪", carriesDate: false }`), matching CFB's own existing hand-appended pattern exactly — no registry change, no adapter, consistent with both features' current architecture.

## Explicit migration/environment risks

- **The build command applies migrations on every deployment, Preview included.** If Preview and Production ever share `DATABASE_URL` (unconfirmed either way — see §7), the first Preview build of this branch applies the new migration to production data automatically, before any application code runs.
- **`DATABASE_URL` scope on the deployed database is unverified.** Cannot confirm whether the new tables already exist there, whether they were applied against production or a staging instance, or whether they exist at all.
- **No rollback tooling exists for the new tables specifically** — see the rollback plan below; this risk is about the ABSENCE of a tested undo path, not a known-broken one.

## Rollback plan

- **Code:** `recovery/platform-baseline` has not been merged to `main` (confirmed §1) — reverting exposure is simply not merging, or `git revert`-ing the relevant commit range on whatever branch it did land on. No force-push or history rewrite needed for a normal rollback.
- **Data:** `PredictionRun`/`ModelPrediction` are new, empty (locally, confirmed clean after every task in this sequence) or unknown-state (remotely) tables with `onDelete: Restrict` from `ModelPrediction` to its parent `PredictionRun` — deleting is possible (`DELETE FROM "ModelPrediction"; DELETE FROM "PredictionRun";`, in that order) but was **never exercised against anything but the local dev database** in this session. No migration-down script exists; Prisma's `migrate deploy` model doesn't generate one automatically — a rollback of the schema itself would need a new, hand-written additive migration that drops the two tables, not an automatic reversal.
- **Deployment:** if a Preview deployment is created per the sequence above and needs to be torn down, that's a normal Vercel dashboard action (delete the deployment/disable the branch) — nothing in this branch's own configuration makes that harder or easier than any other preview.

## Blockers requiring owner input

1. **Vercel Production Branch and Preview/Production `DATABASE_URL` sharing** — both unconfirmable from this session, both directly gate whether step 3 of the integration sequence above is safe to run at all.
2. **Whether to merge `recovery/platform-baseline` to `main`, or keep it as a long-lived preview-only branch** — a real product/process decision, not something this inventory can resolve.
3. **Whether the two stashed efforts (MLB CLV backtest stub, Discord model-trust enforcement) should be resumed, discarded, or left paused** — both are unrelated to CFB/NFL and were not evaluated for priority here, only inventoried.
4. **Whether adding CFB/NFL Research to nav (step 4 of the sequence) is wanted at all**, versus keeping both link-only/hidden indefinitely — a product decision this document surfaces but does not make.

## Changed files / diff stat for this task

```
new file: docs/architecture/PRODUCT-INTEGRATION-INVENTORY.md
```
Nothing else — no application code, schema, migration, UI, Discord, provider, cron, or deployment configuration file was touched. Not committed.

## Recommendation for the next implementation task

The smallest, safest next PR-sized unit of work is **step 1–3 of the integration sequence above, alone** (confirm Vercel Production Branch + staging `DATABASE_URL` scope, then deploy this branch as a Preview against a confirmed-separate database) — entirely a Vercel-dashboard/config task with no code change, and the one that unblocks everything else (nav wiring, real forward captures on a shared/reachable environment, and eventually an owner-facing cross-sport preview) without risking production data. Do not attempt the nav-wiring step (4) until the Production Branch and database-sharing unknowns are confirmed, since a premature Preview deploy against a shared database is the one genuinely irreversible risk this inventory found.
