# ARCHR Edge: model improvement plan and forward validation

**Status:** experimental. Production pricing, calibration, selection, grading and recommendations are unchanged. The shadow model is recorded beside production before every NBA tip and is read only by `eval:shadow`.

**Why:** the audits ([performance](performance-audit.md), [plus-money](plus-money-alpha-audit.md), [fades](contrarian-fade-audit.md)) found no reliable profitable filter. Searching the Nov 6–16 sample for more filter combinations has stopped. The work now is the model itself, judged only on games it has not seen.

**Source of the findings below:** Model lab run #103 (`lab:nba-shadow`, 2026-11-17), a walk-forward replay of every NBA player-game with 10+ earlier games, built from pregame inputs only (`scripts/props/nbaReplay.ts`, shared with `backtest:nba-props`).

| Set | Use | Player-games | Games |
|---|---|---|---|
| **FIT**: 2025-26 season | every constant fitted here, once | 23,038 | 1,173 |
| **CHECK**: 2026-27 before Nov 17 | read once, nothing tuned | 4,082 | 205 |
| **FORWARD**: games from Nov 17 | the only evidence that counts | captured live | — |

The CHECK set overlaps the Nov 6–16 sample the audits already read. It is a sanity check, not evidence of an edge. The replay uses a stand-in line (his last-10 average rounded to the half point), because 2025-26 prop prices aren't stored; the real-line read is the tracked leans (Nov 6–16, 5,936 main-line leans), shown descriptively.

## 1. Minutes uncertainty

**What happens.** The minutes projection misses by 5.1 minutes on average (FIT) and 5.6 (CHECK). A fifth of player-games miss by 8 or more. The misses are lopsided: short nights (10.9% FIT, 15.7% CHECK) outnumber long ones (8.8%, 7.7%).

| | FIT | CHECK |
|---|---|---|
| Mean miss (actual − projected) | −0.34 min | **−1.42 min** |
| Mean absolute miss | 5.06 | 5.55 |
| Misses of 8+ min | 19.6% | 23.5% |
| … of which short / long | 10.9% / 8.8% | 15.7% / 7.7% |
| Same, early exits weighted like any game | −0.23 | −1.33 |
| Plain last-10 average | +0.04 | −0.66 |

**Pregame features that predict a big miss** (share missing by 8+ minutes; each holds in both sets):

| Feature | Low-risk group | High-risk group (FIT / CHECK) |
|---|---|---|
| Minutes SD, last 10 | under 3: 12% / 15% | 7 or more: **29% / 34%** |
| Games well under his median, last 10 | none: 15% / 18% | 2+: **29% / 32%** |
| Role | starter: 17% / 19% | bench: 23% / 27% |
| Starts in last 10 | stable: 19% / 22% | 3–7 (role in flux): 24% / 28% |
| First game back | no: 19% / 23% | yes: 23% / 30% |
| Rotation teammates out | no: 16% / 17% | yes: 22% / 26% |
| Projected minutes | 30–35: 13% / 15% | under 22: 25–26% / 26–27% |

Two causes of the **overprojection**:

1. **Early-season carryover (the larger one).** This season the projection runs 1.4 minutes high, against 0.3 last season. Players projected for 35+ minutes played **6.0 fewer** this season (2.0 last season), and 30% of them missed by 8+. The projection still leans on last season's minutes for the first weeks.
2. **Down-weighting early exits** adds about 0.1 minute (−0.34 vs −0.23). The weighting was fitted for absolute error, which targets the typical night rather than the average one. It's real but small.

**Pregame miss-size model** (the shadow's `minutesScale`, fitted on FIT): it ranks misses out of sample, but weakly. On CHECK the correlation with the realized miss is 0.18. The lowest predicted decile missed by 4.6 minutes and the highest by 8.0. Its 80% band covered 80.9% (constant width: 79.5%).

**The spread couldn't be fitted.** No 2025-26 closing lines are stored, so blowout risk got a zero weight and the FIT projections had no game environment at all.

## 2. Projection variance

**Production's spread is too narrow everywhere, and the widening beyond 0.55 SD is mostly a mean problem, not a spread problem.**

- Standardized residual SD (should be 1): about 1.10–1.17 for points and combos within 0.55 SD of the line, and 1.2–1.4 at 0.55–1 SD (FIT). A tail of projections with far too small a spread (residual SD 6–8 beyond 1 SD on FIT) comes from a few rows whose spread was tiny.
- **The projection regresses toward the line.** Where production sits well above the line, the stat lands well below the projection:

  | Production above the line by | Points | PRA |
  |---|---|---|
  | 0.55–0.75 SD | −2.4 | −2.1 (FIT), −3.8 (CHECK) |
  | 0.75–1 SD | −0.7 | −2.7 (FIT), −5.9 (CHECK) |

  Below the line, it lands above. The far calls are overconfident. At 0.75–1 SD, production said 81% on PRA, and it came in 67% (FIT) and 61% (CHECK).

**Methods compared** (log score of the actual stat, higher is better; stand-in line log loss and 80% interval coverage):

| PRA | Production | s1: minutes mixture | s2: + rate error + κ |
|---|---|---|---|
| Log score FIT / CHECK | −3.469 / −3.500 | −3.434 / −3.484 | **−3.406 / −3.440** |
| Line log loss FIT / CHECK | 0.6958 / 0.7053 | 0.6910 / 0.7172 | **0.6862 / 0.6999** |
| 80% coverage FIT / CHECK | 0.775 / 0.768 | 0.782 / 0.776 | 0.836 / 0.831 |
| Side said vs won at 0.75–1 SD (FIT) | 0.810 / 0.670 | 0.800 / 0.670 | 0.772 / 0.670 |

- **s2 beats production** on log score and on line log loss for **every one of the eight stats in both sets**. Single stats gain less than combos: rebounds 0.6797→0.6758, assists 0.6786→0.6759 (FIT).
- **s1 alone isn't enough.** It's worse than production on CHECK line log loss for points and the combos. The widening, not the mixture, does the work.
- s2 now over-covers a little (0.83–0.85 against 0.80), and its far calls remain overconfident. The rest of the gap is the mean, which no spread fixes (see §5, item 3).

## 3. Combined-stat overprojection

**The 0.3–0.5 point bias isn't specific to combined stats. It's a roughly proportional overprojection of about 2%, which looks larger on bigger numbers.**

| Tracked leans, real lines (Nov 6–16) | Actual − projection | Minutes part | Rate part | Overs | Unders |
|---|---|---|---|---|---|
| Points (888) | −0.34 | −0.11 | −0.23 | −1.50 | +1.44 |
| Pts + reb (838) | −0.50 | −0.12 | −0.39 | −2.09 | +1.54 |
| PRA (677) | −0.51 | −0.11 | −0.40 | −2.58 | +1.79 |
| Pts + ast (678) | −0.50 | −0.22 | −0.28 | −2.21 | +1.47 |
| Reb + ast (672) | −0.29 | −0.08 | −0.21 | −1.01 | +0.58 |
| Rebounds (837) | −0.13 | −0.02 | −0.12 | −0.62 | +0.46 |
| Assists (635) | −0.08 | −0.04 | −0.04 | −0.47 | +0.51 |
| Threes (711) | +0.04 | −0.01 | +0.05 | −0.06 | +0.19 |

Three causes, from the decomposition (actual − projection = minutes miss × rate + actual minutes × rate miss):

1. **Scale.** Points miss by 0.34 and PRA by 0.51, both about 2% of the stat. Combos carry every component's error at once.
2. **Regression toward the line.** The bias flips sign with the side: overs land 2.1–2.6 below projection on combos, and unders 1.5–1.8 above. The net is negative because overs were more frequent and missed by more. Combos depart from the line by more points, so they show it more.
3. **Minutes and early season.** In the replay, minutes are most of it: PRA −0.38, of which −0.28 is minutes (FIT); −1.56, of which −0.99 is minutes (CHECK). On the live leans the rate part is larger (−0.40 of −0.51). This season's per-minute rates are also running below what the two-season blend carries in.

The shadow's skewed minutes mixture lowers the PRA mean by 0.27 (FIT). That's most of the FIT bias (−0.38), but a small part of this season's (−1.56). The early-season carryover needs its own fix (§5).

## 4. Independent predictive signal

Not measured again on the old sample: the audits already answered it there. The books' no-vig chance was as well calibrated as ARCHR (Brier 0.2485 vs 0.2493), and none of 22 factors added anything out of sample (#132, #134). The question is answered forward, below, by comparing ARCHR's raw projection, its corrected chance and the shadow against the books' no-vig chance on the same props.

## The shadow model (v1, `nba-shadow-v1`)

`src/lib/shadow/nbaShadow.ts`. It keeps every production mean input (the minutes projection, the per-minute rate, matchup, pace, environment and absences) and changes only how uncertainty is built:

- **Minutes as a distribution:** production's minutes plus a predicted miss size × ten empirical standardized misses from 2025-26. They're left-skewed, so the mean drops a little.
- **Given the minutes,** a negative binomial with his per-minute dispersion, net of his minutes swings and shrunk toward the stat's typical value.
- **s2** adds the per-minute rate's estimation error and a per-stat variance multiplier κ: 1.5 for points and the point combos, 1.0–1.1 for the rest.

The constants were fitted once on 2025-26 (`SHADOW_PARAMS`). Changing any of them is a new version, and the forward clock restarts.

**Isolation:**

- The capture runs in the same `capture-leans` pass and slate read as the tracked leans, so the inputs are identical at the same moment.
- It writes under its own model key, `shadow:nba-props`. `settle-leans` grades it; the edge report, diagnosis, report cards and screeners never read it (a test enforces this).
- `ARCHR_SHADOW_CAPTURE=0` turns it off.
- The storage boundary refuses any prediction made at or after tip.

**One record per prop:** the Over at the main line, with every forecaster's chance:

- the books' no-vig chance;
- production raw (projection only), model (calibrated), blend (before the side correction) and shown;
- shadow s1 and s2.

Each record also freezes both sides' best prices, the projections and the minutes features.

## Forward validation (pre-registered 2026-11-17, before any forward game was read)

`npm run eval:shadow` (Model lab), pure logic in `src/lib/shadow/forwardEval.ts`.

- **Population:** every NBA main-line prop the shadow froze before tip, games from **Nov 17 (ET)**, version `nba-shadow-v1`. Pushes and voids (DNP) are left out. Every forecaster is scored on the same props: those with a two-sided book quote at capture.
- **Primary:** log loss of the Over chance, **s2 vs the books' no-vig chance**, with a game-cluster bootstrap 95% interval. Read as a result once **250 games** have settled (about 3–4 weeks); earlier reads are labeled interim, and nothing is decided on them.
- **Secondary:**
  - Brier, ECE and reliability bins for every forecaster;
  - each production number vs the books;
  - s2 vs production raw and shown;
  - **independence:** won ~ offset(logit books) + b·(logit forecaster − logit books). b's interval excluding 0 means information beyond the books. The same fit trained on the first half of days and scored on the second half;
  - **one fixed rule's** realized ROI and closing-line value: bet the side with positive EV at the captured best price;
  - single vs combined stats, and production |z| ≥ 0.55 (exploratory).
- **Correlation:** props from one game share minutes, pace and script (residual correlation 0.22 within a game in the audit). Every interval resamples whole games, and the run reports the forward within-game correlation.
- **Integrity:** the run reports captures at or after tip and duplicates. Both must be 0.

**How to read it:**

- A **better log loss than the books, with the interval above zero**, would mean ARCHR's probabilities contain information beyond the market. It would **not**, by itself, mean any betting rule is profitable after the vig.
- Better calibration than production alone, without beating the books, is a model improvement and nothing more.
- The EV rule's ROI is reported for completeness. No betting filter is proposed unless the primary comparison and the independence weight both hold on forward games, and a rule chosen beforehand then holds on further untouched games.

## Prioritized implementation plan

1. **Now (this change):**
   - Shadow v1, recorded before every tip from Nov 17, and `eval:shadow`.
   - The root-cause lab (`lab:nba-shadow`) and the shared replay.
2. **Early-season carryover (largest measured cause of overprojection).**
   - In the shadow: weight this season's minutes and per-minute rates faster in the first weeks, and treat 35+ projected minutes with suspicion.
   - Fit it on the start of 2025-26 only. It becomes **shadow v2**, recorded alongside v1 with its own forward clock; v1's record is never edited.
3. **The mean's regression toward the line.**
   - The shadow can't fix this by widening. It's the old question of how much to trust the projection against the market.
   - Answer it with the forward independence weight b: no new fitting on Nov 6–16.
   - If b is reliably between 0 and 1, the next step is a pre-registered blend at that weight, tested on later games.
4. **Minutes features the replay can't see.**
   - Injury designation (questionable/probable), confirmed lineups and minutes restrictions are live-only, so fit the miss-size model on the forward record itself once a few weeks accumulate. That's a v3 with a fresh clock.
   - Also fit the spread term once 2026-27 closing lines cover enough games.
5. **Keep the history needed for real-line replays.** `NbaPropSnapshot` keeps 90 days, so next season's replay will again lack this season's prices. Archive the main-line pair per prop daily, so future fits can use real lines instead of a stand-in.
6. **Promotion (only after forward evidence).**
   - Production changes only if a shadow version beats production on the primary metric over 250+ forward games, with the interval above zero, and doesn't lose to it on any of the eight stats by more than noise.
   - That is a separate, explicitly approved change. Even then it's a calibration change, not a betting recommendation.

## Reproduce

| What | Command | Notes |
|---|---|---|
| Root cause and fit | `npm run lab:nba-shadow` | Model lab; read-only. Emits `@@TAG@@{json}` lines; `PARAMS` is what `SHADOW_PARAMS` holds. |
| Forward evaluation | `npm run eval:shadow` | Model lab; read-only. |
| Tonight's shadow, without writing | `npm run diagnose:leans` | |
| Tests | `npx vitest run src/lib/shadow` | |
