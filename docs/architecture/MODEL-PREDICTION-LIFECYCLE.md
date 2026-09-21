# Model prediction lifecycle — persistence foundation

> This document covers the generic `PredictionRun`/`ModelPrediction` tables
> added by this task (`prisma/schema.prisma`, `src/lib/predictions/*`). No
> sport writes to these tables yet. See docs/architecture/CFB-V0.md and
> docs/architecture/MLB-MODEL-INVENTORY.md for the audit that identified this
> gap; this doc covers the foundation, not a CFB or MLB writer.

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
  exists today.
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

## What this commit intentionally does not wire

- **No sport writes to this yet.** CFB v0 still computes and discards on every
  request (CFB-V0.md); MLB's live path still reads live tables. Nothing calls
  `createPredictionRun` in production code.
- **No settlement/outcome fields, and no settlement writer.** See "Future
  settlement record direction" below.
- **No lifecycle gating.** `src/lib/engine/trust.ts` is untouched.
- **No UI.** Nothing renders these tables anywhere.
- **No cron.** No scheduled job calls `createPredictionRun`.
- **No CFB registry change.** CFB-V0.md's own stated exit condition — "CFB
  joins the registry only after a full adapter/storage/grading strategy for it
  is approved" — is not met by this task alone.

## Future settlement record direction

Deliberately not built here (see "Revision behavior" constraints in the task
that produced this doc). The intended shape, consistent with `GameOutcome`'s
own precedent of being a separate table from the thing it grades: a
`PredictionSettlement`-style table, one row per settled `ModelPrediction`
(`predictionId` FK), carrying the closing line seen (if any), the final
outcome, and a graded-at timestamp — written by a later job, never by editing
the original `ModelPrediction` row. This keeps every prediction row exactly as
frozen after settlement as before it.

## Future CFB writer — the next task

Once this foundation lands, the smallest next step (per the prior
investigation's recommended sequence) is wiring CFB v0's existing
`predictGame`/`buildTeamRatings` (`src/lib/cfb/`, already pure functions,
CFB-V0.md "Architecture") to call `createPredictionRun` once per game per day,
from a new, explicitly separate script/cron — without touching `/cfb`'s live
render path, and without registering CFB in the sport engine yet. That task is
out of scope here.
