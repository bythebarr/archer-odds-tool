# One Number — summary

Branch `sam/one-number`. Not merged and not deployed: deploys are blocked on the production migration record, and merging waits for review.

## Base

The task said main was at `fd6d1bc`. Main was actually at `399b947`, which already includes Phase 6 ("One Number centralization", `7730422`).

Phase 6 already shipped several pieces this task describes:
- `src/lib/propModel/canonical.ts`, with Projection, ARCHR Chance, Edge and Cautious Edge each defined once;
- the PropBoard relabel to "Hit-rate proj";
- the first `cautiousGrade` and `scripts/backtest-cautious-edge.ts`.

This branch builds on that work instead of redoing it.

## Verdicts

**Step 2 — grading the haircut: DATA REQUIRED.** This environment has no production database. `npm run backtest:cautious-edge` here fails to connect, prints `VERDICT: DATA REQUIRED` and exits 1. No results were produced, and none are claimed.

To get a verdict, run the Model lab workflow with script `backtest:cautious-edge`. It needs:
- the `DATABASE_URL` secret;
- at least **300 graded NBA prop sides**. These come from final games with stored two-sided `NbaPropSnapshot` closing quotes and `NbaPlayerGameLog` box scores, including minutes and starter, for each player before and on that night.

The run prints:
- log loss, Brier, and mean predicted vs actual for the blend, the legacy `min()`, the evidence read, and the evidence read on the plain record. Results are shown for all props, overs, unders, and each stat.
- buckets by each cautious read's edge: ≤0, 0–5%, 5–10%, 10–20%, 20%+ up to the +50% cap, and the distrusted tail. Each bucket shows hit rate against the closing price's implied chance (which answers "did it beat the close?") and flat-stake ROI with a 95% range.
- a K sweep (5/10/20/40), as a diagnostic only;
- the gate decision.

**Step 3 — evidence gate: not met, so the old behavior is kept behind the same interface.** `CAUTIOUS_READ_MODE` in `canonical.ts` is `"legacy-min"`, so every live cautious number is exactly what it was before.

The evidence read is built, wired into every consumer, and tested. It ships only if `evidenceGate()` returns `adopt-evidence`. That requires, on at least 300 samples:
- evidence log loss and Brier no worse than the blend's, and
- evidence log loss strictly lower than legacy `min()`'s.

Shipping it is then a reviewed one-line change to `CAUTIOUS_READ_MODE`. Every explainer reads `CAUTIOUS_READ_MATH[CAUTIOUS_READ_MODE]`, so the copy changes along with the flag.

## The four numbers

| Number | What it is | Single source |
|---|---|---|
| Projection ("Proj line") | Stat value, e.g. 24.6 points | `CANONICAL_NUMBERS.projection` |
| ARCHR chance ("ARCHR") | The blend: the one probability | `archrChanceOf` (from `priceProp`) |
| ARCHR edge | EV of the best price at ARCHR chance | `edgeFromChance` |
| Cautious edge — ranking only | The cautious read vs the price-implied chance, minus 1; never quoted as a chance | `cautiousChance` / `cautiousEdge` |

## The evidence read (Step 3 math)

The record becomes a Beta update on ARCHR chance instead of a `min()` veto:

```
read = (hits + K·p) / (games + K),   K = EVIDENCE_PRIOR_GAMES = 20
```

The record pulls the read by games / (games + K):
- 3 games move it 13% of the way toward the record;
- 10 games move it 33%;
- 20 games move it 50%.

It can move the read up or down, so it has no built-in downward bias.

Other rules:
- With no record, the read is ARCHR chance.
- With a record but no ARCHR chance, it uses the Laplace-smoothed record, and only when there are at least 3 games.
- The +50% trust cap is unchanged.

**Role weighting (NBA).** Each past game counts by a Gaussian on the gap between its minutes and tonight's projected minutes. The width is max(4, 20% of tonight's minutes). The weight is halved again when starter vs bench differs from tonight.

Tonight's role comes from `nbaTonightRole`:
- minutes: the same figure the props projection uses;
- starter: the posted lineup if there is one, otherwise `projectNbaMinutes`' role.

A stale bench record therefore barely counts after a promotion. The test "a stale record must NOT cap a rising model" pins this down: legacy reads under 30%, while the evidence read stays at or above the model's 62%.

## File-by-file

**Step 1 / Step 3 — canonical module and evidence read**
- `src/lib/propModel/cautiousRead.ts` (new):
  - `legacyCautiousChance`, which is the existing `conservativeProb` itself, so there is one implementation;
  - `evidenceCautiousChance`, `EVIDENCE_PRIOR_GAMES`;
  - `roleWeight`, `roleWeightedRecord`, `roleWeightedRates`.
- `src/lib/propModel/canonical.ts`:
  - `CautiousReadMode` and `CAUTIOUS_READ_MODE` (`"legacy-min"`);
  - `CAUTIOUS_READ_MATH` and `cautiousReadMath`;
  - mode-aware `cautiousChance` / `cautiousEdge`, which take an optional role-weighted record;
  - Cautious edge label is now "Cautious edge — ranking only", and its blurb is built from the live math.
- `src/lib/builder/conservative.ts`: docblock only. It is now documented as the legacy read plus the relative-edge primitives, reached through canonical.
- `src/lib/builder/optimize.ts`: the candidate filter reads `cautiousChance` from canonical (with `roleRates`) instead of calling `conservativeProb` directly. Selection is identical in legacy mode.
- `src/lib/builder/build.ts`: `legConservativeEdge` passes `roleRates`.
- `src/lib/screener/types.ts`: `ScreenerProp.roleRates` (l10, szn); `conservativeEdge` passes the matching role-weighted window.
- `src/lib/builder/types.ts`: `BuilderLeg.roleRates`.
- Plumbing:
  - `src/lib/props/parlay.ts`: `ParlayLog.minutes` / `starter`;
  - `src/lib/props/parlayFinder.ts`: `FinderLeg.tonight`;
  - `src/lib/nba/parlayLegs.ts`: fills both;
  - `src/lib/nba/slateContext.ts`: `nbaTonightRole` (`nbaTonightMinutes` now delegates to it, with the same figure);
  - `src/lib/screener/sources.ts`, `src/lib/builder/sources/teamLeague.ts`: attach `roleRates` to NBA rows and legs.

**Step 2 — grading**
- `src/lib/propModel/cautiousGrade.ts`:
  - scores blend, legacy, evidence, and evidence-plain on the same samples;
  - per-read buckets with ROI and its 95% range against closing prices;
  - `PRIOR_SWEEP`, `evidenceGate` (`MIN_GATE_SAMPLES` = 300).
- `scripts/backtest-cautious-edge.ts`:
  - grades both sides of each consensus line;
  - builds the role-weighted L10 from that night's projected minutes and role (prior games only, so tonight's actual minutes never leak in);
  - prints the gate verdict, or "VERDICT: DATA REQUIRED" with exactly what it needs, and exits non-zero.
- `.github/workflows/model-lab.yml`: `backtest:cautious-edge` added to the choices (read-only).

**Step 4 — one language**
- `src/components/props/kit.tsx`: `ModelChip` was labeled "Model" over the blend. It now reads "ARCHR", with the ARCHR chance explainer on hover. This covers the NBA, NFL and MLB finder boards.
- `src/components/props/PropGameChart.tsx`: the chart legend labeled the stat projection "ARCHR"; it now reads "Proj line".
- `src/app/nba/hot/page.tsx` + `src/lib/nba/standouts.ts`:
  - Hottest Tonight now headlines ARCHR chance (the blend, the same number as every other props surface).
  - The calibrated standout read stays visible as "adj." with an explainer, and still ranks the page.
  - Alt-line EV is now ARCHR edge, computed from ARCHR chance at the rung (`alt.rawChance` was added; the rung picker is unchanged).
  - Projection is labeled "Proj line".
- `src/app/parlay-builder/page.tsx`:
  - the optimizer's product was shown as "est. chance"; it is now "cautious score — ranking only";
  - the parlay shows ARCHR chance and ARCHR edge;
  - the "cons. EV" figure, a second edge, was removed;
  - leg rows read "caut." and "caut. edge" with hover notes;
  - the explainer describes the live read.
- `src/components/screener/PropsScreener.tsx`: the Cautious edge header and explainer now describe the live read through `cautiousReadMath`.
- PropBoard was already relabeled "Hit-rate proj" in Phase 6 and was not touched.

**Step 5 — tests**
- `src/lib/propModel/cautiousRead.test.ts` (new) covers:
  - legacy = old `min()`;
  - no record, thin record, and a 20-game record;
  - the read moving up as well as down;
  - role weighting, including the role-change case "stale record must NOT cap a rising model";
  - windows and nulls; `roleWeightedRates`;
  - canonical mode default, with legacy ignoring `roleRates`.
- `src/lib/propModel/cautiousGrade.test.ts` (rewritten) uses synthetic fixtures for:
  - same-sample scoring;
  - legacy never above the blend while evidence can be;
  - min() costing accuracy on a calibrated blend;
  - role weighting beating the plain record;
  - buckets with ROI;
  - the empty set;
  - all three gate outcomes.
- `src/lib/propModel/canonical.test.ts`: ranking-only label, and the explainer matching the live mode.

## Test counts

|  | Files | Tests | Typecheck |
|---|---|---|---|
| Before (`399b947`) | 169 | 1,488 | clean |
| After (this branch) | 170 | 1,509 | clean |

Each commit on the branch was checked with `tsc --noEmit` and the full vitest suite before it was made.

## Left alone, on purpose

- **Model weights, blend weights, thresholds and selection logic.** Unchanged:
  - `DEFAULT_MODEL_WEIGHT`, `STANDOUT_EDGE_SHRINK`;
  - standout ranking and bar, and the alt-rung picker;
  - optimizer ranking, `MIN_GAMES`, `MAX_TRUSTED_RELATIVE_EDGE`;
  - screener and builder filters.

  `EVIDENCE_PRIOR_GAMES` = 20 is a new constant for a read that is not live. The backtest sweeps it for review, and it is never refit automatically.
- **Trust badges** (`src/lib/props/provenance.ts`): untouched, still keyed to the blend report cards.
- **Pick tracking** (`src/lib/tracking/*`): untouched. NBA leans still record the standout-adjusted chance as `prob` and the blend as `rawProb`. The capture comment calls `prob` "the chance the product DISPLAYS"; it is still displayed, as "adj.", but it is no longer the headline. A reviewer may want that comment reworded.
- **Game-model "Model" labels** (BetSheet, UFC fight card, EventBreakdown): these are game models, not props, so they are out of scope.
- **"Model" inside the prop sheets' blend breakdown** (`ModelPieces.BlendLine`): this is the pre-blend step shown on its way to ARCHR chance, which canonical allows (`modelChanceOf`). It is not a headline.
- **NFL collection for the grading backtest**: still the follow-on. The script grades NBA only.

## Judgment calls for review

1. **Hottest Tonight headline.** An earlier audit, noted in `capture.ts`, found the calibrated standout chance grades closer to the result than the raw blend on these picks. So the calibrated figure was not dropped or called "ranking only". It is shown as "adj." and still ranks the page, while the headline is ARCHR chance, so the same prop shows the same number on every page.

   The trade-off: ARCHR edge on the alt rung is now computed from the uncalibrated chance, which that audit says runs high on standout picks. If review prefers the calibrated figure as the headline, it should get its own canonical name, not "ARCHR".
2. **Fallback is a code constant, not an environment toggle.** Every server render and every surface has to read the same number, and flipping it should go through review.
3. **Buckets.** "20%+" is split at the +50% trust cap: 20–50% are tradeable, and anything above 50% is the distrusted tail, which no surface ranks.
