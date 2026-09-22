# Model prediction lifecycle — persistence foundation

> This document covers the generic `PredictionRun`/`ModelPrediction` tables
> (`prisma/schema.prisma`, `src/lib/predictions/*`). See
> docs/architecture/MLB-MODEL-INVENTORY.md for the audit that identified this
> gap. CFB v0 and NFL's experimental Elo research slice are the two writers
> onto this foundation so far — see docs/architecture/CFB-V0.md's
> "Forward-prediction capture" and docs/architecture/NFL-RESEARCH.md for each
> one's specific use of it. MLB has no writer yet.

## Why `PostedPlay` is not prediction history

`PostedPlay` (`prisma/schema.prisma`) looks, at a glance, like it might already
cover this: it has `sport`, `matchId`, `market`, `side`, `point`, `ev`,
`units`, and a `gradedAt`/`result` pair. It is not the same thing, for three
structural reasons:

1. **It is a small, owner-curated subset, not every prediction.** `PostedPlay`
   rows are written only for plays that actually went out on `#todays-card` or
   `#free-play` (`recordPlays`, `src/lib/discord/postCard.ts`) — the deck's
   handpicks (`CardSelection`), not the full board the model priced. The
   `#ev-slate` firehose — everything the engine surfaced — is explicitly
   **never recorded** (`src/lib/card/selection.ts`'s docstring: "NEVER
   recorded, so it can't move a record nobody staked"). A model can generate
   dozens of predictions a day and have zero of them appear in `PostedPlay`.
2. **It is upserted, not append-only.** `recordPlays` uses `prisma.postedPlay
   .upsert(...)` keyed on `(postedForDate, playKey)` — a re-post on the same
   date for the same play updates nothing (empty `update: {}`), but the
   pattern itself is mutate-in-place, and `gradedAt`/`result`/`voided` are
   written onto the *same row* later by grading. `ModelPrediction` rows are
   never updated after creation — see "Immutability and revision semantics"
   below.
3. **It has no model-version, generated-at, data-as-of, or feature-snapshot
   fields at all.** `ev`/`units` are the *posted* price's derived numbers, not
   the model's raw probability, and there is nothing recording what inputs the
   model actually saw or when. `docs/architecture/MLB-MODEL-INVENTORY.md` §5
   documents this precisely: the live pricing path and the backtest
   reconstruction are separately-coded "as of" derivations, and nothing
   anywhere freezes what the live path actually used on a given day.

`PostedPlay` answers "what did we tell Discord, and how did it grade?"
`PredictionRun`/`ModelPrediction` answer "what did the model say, for
everything it considered, before any human curated it and before any outcome
existed?" Both are legitimate, different tables. Neither should be extended to
cover the other's job.

## Run / prediction separation

- **`PredictionRun`** is the *batch*: one execution of one versioned model, at
  one moment, against one data-as-of cutoff. It carries the model's identity
  (`sportKey`, `modelKey`, `modelVersion`), its lifecycle stage *as of that
  run* (`lifecycle`), when it ran (`generatedAt`), what cutoff its inputs
  respected (`dataAsOfUtc`), a frozen calibration snapshot, and a feature-
  schema version tag.
- **`ModelPrediction`** is one *line item* inside a run: one event, one
  market, one selection, the model's probability/projection for it, and the
  exact feature/input snapshot and market snapshot the model saw at that
  moment.

This mirrors the existing `SportModel`/`ModelBacktest`/`CalibrationSnapshot`
split in `src/lib/engine/types.ts` — a run-level "what produced this" record
and a per-sample "what was predicted" record — deliberately, rather than
inventing a new shape.

## Immutability and revision semantics

- **This is application-level append-only behavior, not database-enforced
  immutability.** There is no `update`/`delete` export anywhere in
  `src/lib/predictions/` — the only writer is `createPredictionRun`
  (`src/lib/predictions/store.ts`), and it only calls `create` (via
  `tx.predictionRun.create`/`tx.modelPrediction.create`), never `upsert` or
  `update`. But nothing in the migration adds a database trigger, a
  `REVOKE UPDATE`/`REVOKE DELETE` grant, or any other DB-level mechanism that
  would stop a direct `UPDATE`/`DELETE` statement (raw SQL, `$executeRaw`, a
  future script, direct DB access) from mutating or removing a row. The
  guarantee today is "nothing in this module's public API can do it," not
  "the database physically cannot do it." The one DB-level protection that
  does exist is narrower: `ModelPrediction.run`'s foreign key is
  `onDelete: Restrict` (not `Cascade`), so deleting a `PredictionRun` that
  still has predictions fails loudly at the database level rather than
  silently cascading — see the schema's own comment on that relation.
- **A later run for the same event/market/selection is a new row, not an
  overwrite.** Nothing in the schema or the storage layer prevents two runs
  from both predicting, say, `(eventRef: "espn-401628345", marketKey: "h2h",
  selectionKey: "home")` — that is the entire point: each run is a frozen
  opinion at a point in time, and a later, revised opinion is additive
  history, not a correction applied in place.
- **What *is* rejected: a duplicate selection inside the same run.** The
  `@@unique([runId, eventRef, marketKey, selectionKey])` constraint on
  `ModelPrediction`, backed by `validatePredictionRunInput`'s pre-write
  duplicate check (`src/lib/predictions/validate.ts`), rejects a run that
  tries to predict the same event/market/selection twice in one batch — this
  is guarding against a caller-side bug or an accidental retry duplicating a
  row within one run's write, not restricting revision across runs. Both the
  in-memory check and the database constraint compare `(eventRef, marketKey,
  selectionKey)` as **exact, case-sensitive, un-normalized strings** — the
  same three raw values, the same way, in both places, deliberately, so
  "would this be rejected as a duplicate" never depends on which layer
  catches it. This also means two selections that differ only by
  incidental whitespace or casing (e.g. `"home"` vs. `"Home"`) are treated as
  genuinely different selections by both layers, not silently merged — the
  caller is responsible for supplying a consistent identity string.
- **This only guarantees per-run uniqueness, not cross-run idempotency.** An
  accidental retry of an *entire* run (not just a duplicated selection within
  one) — e.g. a caller that times out waiting for `createPredictionRun` to
  return and calls it again with an equivalent payload — currently produces
  two independent, equally valid runs, since `PredictionRun` has no
  caller-supplied idempotency key and its `id` is freshly generated on every
  call. Nothing in this module claims otherwise; if a future caller needs
  retry-safety across whole runs (not just within one), that's a deliberate
  addition to design and test for at that point, not something to assume
  exists today. **CFB is the first caller to need this**, and deliberately
  does NOT add a schema-level key here — see CFB-V0.md's "Retry protection"
  and `capturePredictions.ts`'s `shouldBlockRerun` for why an
  application-level, confirmable check (not a database constraint) was the
  right call for that specific use case, and why a future caller with
  different needs should make its own decision rather than assume this one
  generalizes.
- **Stable event identity does not depend on any display name.**
  `ModelPrediction.eventRef`/`marketKey`/`selectionKey` are opaque
  identifiers (an ESPN event id, a stable market/side key) — there is no
  `selectionLabel`-style human-readable field on this table at all (contrast
  `PostedPlay.selectionLabel`), so there is nothing here that could be
  mistaken for, or accidentally used as, identity.

## Lifecycle meanings

`ModelLifecycle` (`prisma/schema.prisma`) is frozen onto each `PredictionRun`
at creation time — never a live join to some other "current status" table:

- **`experimental`** — a model still being developed/reviewed. Visible in
  staging/research contexts only, never auto-posted. This is CFB v0's current
  de facto status today, just not yet labeled as such anywhere structural
  (CFB-V0.md: "not registered in the sport engine... never touches the
  graded-play pipeline").
- **`validated`** — historically and/or forward tested, but still clearly
  labeled as such wherever shown. Mirrors the posture `docs/architecture/
  calibration.md` already describes for tennis/soccer/NFL: calibration-
  "trusted" (honestly calibrated) but explicitly *not* claimed to beat the
  market, and kept signal-only.
- **`production`** — eligible for normal live surfaces and trust-gated
  content, the same status MLB has today by default (though, per
  `EDGE-BASELINE-AUDIT.md` §4, MLB's own trust gate — `isModelTrusted`,
  `src/lib/engine/trust.ts` — is built but wired to nothing that posts, so
  "production" today means "posts regardless of calibration verdict," not "has
  cleared a bar").

**Why frozen, not live:** if `lifecycle` were read live from some current
model-status table, promoting or demoting a model later would silently
reinterpret what every old run "was" at the time. A `PredictionRun` created
while a model was `experimental` must stay legible as an experimental-era
prediction forever, even after the model is later promoted to `production` —
otherwise a forward-test record could be retroactively dressed up as having
been production-grade all along.

This task does **not** wire `lifecycle` into `src/lib/engine/trust.ts`'s gate,
the board, or Discord. `isModelTrusted` continues to read only
`SportModel.calibration` exactly as it does today.

## Point-in-time requirements this closes

Restating the point-in-time integrity questions from the prior investigation,
against what now exists:

| Question | Before this task | After this task |
|---|---|---|
| Can a prediction be proven to predate its game? | No prediction was ever stored | `generatedAt`/`dataAsOfUtc` are validated strictly before `scheduledStartUtc` at the storage boundary (`src/lib/predictions/validate.ts`), and `dataAsOfUtc` is additionally validated to never be after `generatedAt` itself |
| Can current aggregates be mistaken for historical ones later? | Yes — the live path always reads current tables (`MLB-MODEL-INVENTORY.md` §5) | `featureSnapshot` freezes the exact inputs used, per prediction, at write time |
| Can a later formula change reinterpret an old prediction? | N/A — nothing was stored to reinterpret | No — rows are immutable; a changed model writes new rows under a new `modelVersion`, never edits old ones |
| Is the calibration/trust state at generation time knowable later? | No — `CalibrationSnapshot` is a single mutable field, overwritten on every re-bake | `calibrationSnapshot` is copied onto the run at creation, not joined live |

## What this still intentionally does not wire

- **CFB v0's own `/cfb` board is completely untouched.** It still computes
  and discards on every request, exactly as before (CFB-V0.md
  "Architecture") — capture is a wholly separate, manual, opt-in path
  (`scripts/capture-cfb-predictions.ts`) that runs alongside it, never inside
  its render path. MLB's live path still reads live tables and has no writer
  yet.
- **No settlement/outcome fields, and no settlement writer.** See "Future
  settlement record direction" below — still not built.
- **No lifecycle gating.** `src/lib/engine/trust.ts` is untouched; CFB's
  `lifecycle: "experimental"` is stored but read by nothing yet.
- **No UI.** Nothing renders `PredictionRun`/`ModelPrediction` anywhere.
- **No cron or schedule.** `capture:cfb:predictions` is manual-only, run by
  hand — no Vercel Cron entry, no GitHub Actions workflow.
- **No CFB registry change.** CFB-V0.md's own stated exit condition — "CFB
  joins the registry only after a full adapter/storage/grading strategy for it
  is approved" — is still not met. CFB has no `Sport` enum entry, no `Game`
  row, and no Discord/deck eligibility of any kind; `PredictionRun.sportKey`
  is a plain `"cfb"` string, same posture as every other open identity field
  in this module.

## Future settlement record direction

Deliberately not built here (see "Revision behavior" constraints in the task
that produced this doc). The intended shape, consistent with `GameOutcome`'s
own precedent of being a separate table from the thing it grades: a
`PredictionSettlement`-style table, one row per settled `ModelPrediction`
(`predictionId` FK), carrying the closing line seen (if any), the final
outcome, and a graded-at timestamp — written by a later job, never by editing
the original `ModelPrediction` row. This keeps every prediction row exactly as
frozen after settlement as before it.

## The CFB writer (implemented)

CFB v0 is the first writer onto this foundation. See CFB-V0.md's
"Forward-prediction capture" section for the full description of what's
stored and how to run it; the short version, in terms of this document's own
vocabulary:

- **Pure builder:** `src/lib/cfb/predictionCapture.ts`'s
  `buildCfbPredictionRun` — no Prisma, no network, exhaustively unit-tested
  (`predictionCapture.test.ts`).
- **Thin orchestration:** `src/lib/cfb/capturePredictions.ts`'s
  `captureCfbPredictions` — fetches ESPN, builds the rating book, calls the
  pure builder, then `createPredictionRun`.
- **Execution surface:** `scripts/capture-cfb-predictions.ts`
  (`npm run capture:cfb:predictions`) — manual only, no cron.
- **Model identity:** `src/lib/cfb/modelIdentity.ts` — `cfb-srs` / `v0.1.0` /
  `experimental`, hand-bumped.

`src/lib/predictions` itself has no CFB (or any sport-specific) import
anywhere — the dependency runs one way, CFB depends on the generic module,
never the reverse.

**A concrete instance of the "count distinct runs, not rows" rule above:**
CFB writes TWO `ModelPrediction` rows per game (`selectionKey: "home"` and
`"away"`, same `marketKey: "h2h"`, complementary probabilities summing to 1)
— see `buildCfbPredictionRun`'s own docstring. A future calibration pass over
this data must count distinct `(eventRef, marketKey)` pairs, not rows, or it
will silently double-count every CFB game as two independent samples.

**What this does NOT unlock, stated plainly (nothing here changes with this
writer existing):** no CLV or spread/total-market evaluation — CFB collects
no server-side market line at all, so there is nothing to compare a
prediction against; no market validation of any kind; no claim that the
model's spread/total accuracy has been checked; no lifecycle above
`experimental`; no paid provider or API key was added or is required for
this writer (ESPN only, free/unkeyed).

## The NFL research writer (implemented)

The second writer onto this foundation, and the first to reuse an ALREADY
production-validated model layer (`src/lib/nfl/elo.ts`/`model.ts`, unchanged
by this writer) rather than a brand-new one. See
docs/architecture/NFL-RESEARCH.md for the full description; in this
document's vocabulary:

- **Pure builder + shared prediction function:**
  `src/lib/nfl/research/predictionCapture.ts` — `computeNflGamePrediction`
  is the ONE place win probability/expected margin/warnings are computed,
  called identically by the display page and the storage path (so a
  rendered card and a stored prediction can never disagree); `buildNflResearchSlate`/
  `buildNflResearchPredictionRun` assemble the run. No Prisma, no network.
- **As-of reconstruction:** `src/lib/nfl/research/eloAsOf.ts`'s
  `buildNflEloAsOf` replays nflverse history through the EXISTING `NflElo`
  class — no reimplemented formula.
- **Explicit identity validation:** `src/lib/nfl/research/teamIdentity.ts` —
  found and fixed a real ESPN-to-nflverse mismatch (the Rams: `"LA"`, not
  this codebase's own `"LAR"`) by checking against real fetched data rather
  than assuming a display abbreviation is also the data-source's key.
- **Thin orchestration:** `src/lib/nfl/research/captureSnapshot.ts`'s
  `captureNflResearchSnapshot` — fetches ESPN + nflverse, builds the slate,
  checks the retry guard, calls `createPredictionRun`.
- **Execution surface:** a Server Action (`src/app/nfl/research/actions.ts`),
  triggered only by a button on `/nfl/research` — no CLI script, no cron,
  matching this writer's "deliberate user action" requirement more directly
  than a command-line invocation would.
- **Model identity:** `src/lib/nfl/research/modelIdentity.ts` — `nfl-elo` /
  `v0.1.0` / `experimental`, hand-bumped, distinct from `NFL_MODEL`
  (`src/lib/nfl/model.ts`)'s calibration-harness identity.

Same "count distinct runs, not rows" rule as CFB: two `ModelPrediction` rows
per game (`home`/`away`, same `marketKey: "h2h"`, complementary
probabilities). Same retry-guard posture as CFB: no DB-level idempotency
key, a soft database-backed check-then-confirm gate instead (see
`captureSnapshot.ts`'s `shouldBlockRerun` docstring), with the same honest
scope note — it catches a retry after an earlier finished attempt, not two
truly simultaneous ones.

**What's different from CFB, and why:** CFB's guard buckets by a
caller-supplied calendar date; NFL research has no per-invocation date
parameter (it always operates on "the current week"), so it instead checks
the EXACT set of ESPN `eventRef`s in the current eligible slate — a prior
run only blocks a new one if it actually recorded a prediction for one of
THIS slate's specific games (an earlier version matched by a kickoff-time
date range instead, found by adversarial review to be over-broad around bye
weeks — see `captureSnapshot.ts`'s own docstring on `findExistingRunForEvents`).
The Server Action takes no untrusted prediction payload from the client; it
re-derives everything server-side from a single boolean (`confirmRerun`),
per Next.js's own Server Actions security guidance that every action is an
untrusted, unauthenticated entry point.

**What this does NOT unlock:** identical list to CFB's above — no CLV, no
market validation, no lifecycle above `experimental`, no paid provider. Plus
one NFL-specific fact: the underlying model's own CLV backtest is not just
"not yet run" (CFB's situation) but **already run and negative**
(`docs/architecture/calibration.md`) — this writer does not change that
verdict, and nothing it stores should be read as contradicting it.
