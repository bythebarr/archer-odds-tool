# ARCHR Edge: plus-money alpha audit

This is measurement only. Nothing in pricing, probability calibration, selection, grading or recommendations changed.

**Source.** Model lab run #102 (`audit:plus-money`), production database, 2026-11-17. Every number below comes from that run's JSON output.

**Related documents:**
- every segment: [`plus-money-alpha-segments.md`](plus-money-alpha-segments.md);
- the fade investigation (Phase 5, Table B): [`contrarian-fade-audit.md`](contrarian-fade-audit.md);
- the earlier audit this builds on: [`performance-audit.md`](performance-audit.md).

## Final decision

1. **Is any NBA plus-money strategy demonstrably profitable out of sample?** **No.**
   - All plus-money main-line picks: −10.8% ROI [−19%, −3%] (625 picks, 80 games).
   - They won 41.8% when ARCHR said 51.1% and the books' no-vig said 44.2%.
   - No plus-money filter has an ROI interval above zero in any period.
2. **Does |z| 0.35–0.75 remain useful specifically at plus money?** **It can't be tested.**
   - Only 78 plus-money picks fall in that band, 25 of them after the correction.
   - All picks: −5.5% ROI [−33%, +19%]. After the correction: +10.7% [−36%, +60%]. Both are noise.
   - At minus money the band looked better after the correction (won 6.8 pts over no-vig [−0.2, +13.8]). But it's barely positive in discovery (+1.1), and the post data is what suggested it.
3. **Should |z| above 0.75 be faded?** **No.**
   - Faded at the actual recorded opposite price, the record is −12.1% ROI [−33%, +7%] (253 fades).
   - Discovery −15.7%, after the correction −5.5%.
   - ARCHR is overconfident there (the projection's spread is too narrow; Phase 7), but the books already price it.
4. **Can alternate-line overconfidence be exploited at actual opposite prices?** **Not testably.**
   - Only 211 of 2,471 alt picks (8.5%) have a recorded opposite quote at the same line, and that subset is selected by where DraftKings happened to hang both sides.
   - Fading the main line instead (a different bet) returned −1.7% [−7%, +4%].
5. **Does any combination beat a sportsbook-only baseline?** **No.**
   - Trained on discovery and judged on later games, no single factor and no predeclared combined model improves on the books' no-vig chance. The combined model's log-loss change is −0.06‰ [−3.1, +3.8].
   - None of the 22 prospective factors survives false-discovery control in sample either.
6. **What's the most defensible filter to track prospectively?** **`distance-035-v1`**: ARCHR's side with the projection 0.35+ past the line.
   - It isn't proven. It's the one rule fixed before this audit and now tracked forward with every pick (#133).
   - Its past record: −0.4% ROI [−7%, +6%], won 3.1 pts over no-vig [−0.6, +6.7] on 1,827 picks.
   - It's the least-bad historical rule, with no plus-money restriction.
7. **What must be measured before recommending six plus-money picks a day?**
   - **First, a single-bet edge must exist.** None does today.
   - **A forward sample with a predeclared rule:** about 2,000 picks at plus money for a ±5% ROI interval.
   - **Real line shopping:** every price today is DraftKings'.
   - **Opening prices**, so CLV means something; most closes don't move.
   - **Injury and lineup status at capture.**
   - **A dependence model:** a player's own props on one night correlate at 0.22.
   - **No six-leg parlay should be built** from picks with no single-bet edge.

**Bottom line: no profitable strategy has been established, plus money or otherwise.** ARCHR's NBA main-line chances are about as accurate as DraftKings' no-vig chances (Brier 0.2493 vs 0.2485), and where they disagree, the books are closer. At plus money ARCHR is most overconfident: 51% said, 42% won. The evidence can't support recommending any filter as profitable. It can only nominate what to track.

## Phase 1: what data is trustworthy

| | |
|---|---|
| Settled NBA prop picks | 9,449. Voids set aside: 355. Pushes: 0. Graded: 9,094. |
| Duplicates (game × player × stat × line type) | **0** |
| Frozen at or after tip (leakage) | **0** |
| **Main-line picks with a price** | **6,622** · 80 games · 11 slate days (Nov 6–16) |
| Discovery (frozen before the Nov 12 22:29 UTC correction) | 3,958 · 48 games · 7 days |
| After the correction | 2,664 · 32 games · 5 days |
| Forward-tracked (frozen after the Nov 17 deploy) | 0 settled yet |
| Alternate-line picks | 2,471 · 73 games · 10 days (1,809 discovery, 662 after) |
| Games per slate day | 4–10 (median 7) |

**Recorded before tip, for each main-line pick:**
- the price (6,622);
- the books' no-vig chance (6,620);
- the projection's z (6,621) and projected minutes (6,622);
- the closing no-vig chance (6,621);
- the Confidence grade (2,565, since Nov 12).

**Not recorded at all:** opening prices, injury status for NBA picks, and screener records (frozen only since Nov 17).

**Rebuilt from earlier box scores only:** L5/L10/L15/season records, games of history, starter share, and minutes change (projected minus the last-5 average).

**Opposite-side prices are recorded.** DraftKings quotes on both sides of every line are kept in `NbaPropSnapshot` for 90 days.
- For **6,620 of 6,622** main-line picks, the opposite side's quote (same game, player, stat, line and book) exists at or before the pick's decision time. The median quote is 0.35 h old.
- The pick's own side was checked against its recorded price: **94% match** (98% discovery, 88% post). Mismatched picks, a re-poll between quote and capture, are left out of fades.
- The arithmetic reconstruction from the recorded no-vig chance agrees with the recorded opposite quote exactly (median and 90th-percentile difference both 0). That validates the stored no-vig chances, but the reconstruction is used for nothing.

**Alt lines:** only 211 of 2,471 (8.5%) have an opposite quote at the same line.

**Which data is "untouched".** Every hypothesis here (plus money, |z| bands, the five fades) was shaped by `performance-audit.md`, which had already looked at both periods. **So discovery and post are both exploratory for these questions.** Chronological splits still keep rules from being judged on the data that tuned them, but no part of the historical data is independent confirmation. Only picks frozen from Nov 17 on are untouched, and none have settled.

**Correlation.** Each interval is a cluster bootstrap over games (400 draws).

| Pair of picks | Residual correlation | Pairs |
|---|---|---|
| Same player, same game | **0.22** | 20,560 |
| Different players, same game | 0.016 | 277,409 |
| Different games, same day | 0.001 | |

About 83 picks per game are therefore far from 83 independent trials. The effective sample is closer to the 80 games.

## Phase 2: plus-money prices (main lines)

| Price | Picks | Games / days | Won | ARCHR | No-vig | Break-even | ARCHR EV | ROI [95%] | Won − no-vig [95%] | CLV |
|---|---|---|---|---|---|---|---|---|---|---|
| −101 or shorter | 5,997 | 80 / 11 | 51.9% | 52.4% | 51.8% | 55.2% | −4.7% | −6.0% [−10, −3] | +0.1 [−1.8, +1.9] | −0.1 |
| **+100 to +124** | 532 | 80 / 11 | **41.4%** | 51.2% | 45.1% | 48.1% | +6.7% | **−13.6% [−23, −6]** | −3.6 [−8.2, −0.1] | +0.4 |
| +125 to +149 | 81 ⚠ | 46 / 11 | 43.2% | 50.1% | 40.0% | 42.6% | +17.6% | +1.6% [−25, +29] | +3.2 [−7.9, +15.1] | +0.8 |
| +150 to +174 | 11 ⚠ too few | 10 / 5 | 45.5% | 49.9% | 36.2% | 38.6% | +29.5% | +16.4% [−49, +85] | +9.2 | +1.5 |
| +175 to +199 | 1 ⚠ too few | 1 / 1 | | | | | | | | |
| +200 and higher | **0** | | | | | | | | | |
| **+100 to +174 combined** | 624 | 80 / 11 | 41.7% | 51.1% | 44.2% | 47.2% | +8.5% | **−11.1% [−19, −4]** | −2.5 [−6.3, +1.0] | +0.4 |

**By period, all plus money:**

| Period | Picks | Won | ARCHR | No-vig | ROI [95%] | Won − no-vig |
|---|---|---|---|---|---|---|
| Discovery | 367 | 39.0% | 51.1% | 44.2% | −16.7% [−27, −7] | −5.2 [−9.9, −0.7] |
| After the correction | 258 | 45.7% | 51.0% | 44.2% | −2.4% [−16, +11] | +1.5 [−4.8, +7.8] |

**Reading it:**
- **ARCHR is badly miscalibrated at plus money:** 9.3 pts over in all picks, 12.1 pts in discovery. The books' no-vig chance is much closer.
- ARCHR's "positive EV" at plus money (median +7.3%) comes from that disagreement, not from an edge. The books' expected value on the same picks is −6.3% (the vig) in every bucket.
- Only +100 to +124 has a real sample. Above +150 there are 12 picks in total and above +200 none, so those price ranges **cannot be assessed**.
- Plus-money main lines are only about 9% of picks.

**Alternate lines are mostly plus money:** 2,471 picks at an average of +199.
- They won 30.3% when ARCHR said 37.4%: ROI −13.6% [−21, −6].
- The gap was −10.8 pts in discovery and +3.1 after the correction. The alt correction (`NBA_ALT_FIT`) was fitted on these picks, so the later number is in sample.

## Phase 3: projection distance

| \|z\| | Picks | Won | ARCHR | No-vig | ROI [95%] | Won − no-vig [95%] | Discovery ROI | After-correction ROI |
|---|---|---|---|---|---|---|---|---|
| below 0.20 | 3,086 | 48.6% | 50.7% | 50.4% | −9.4% [−13, −6] | −1.7 [−3.7, +0.1] | −12.3% | −5.3% |
| 0.20–0.35 | 1,708 | 50.5% | 52.2% | 51.3% | −7.6% [−13, −3] | −0.7 | −7.4% | −8.0% |
| 0.35–0.55 | 1,143 | 56.7% | 53.9% | 52.1% | +2.4% [−5, +8] | **+4.6 [+0.4, +7.9]** | −2.8% | +10.1% |
| 0.55–0.75 | 422 | 51.7% | 55.8% | 52.4% | −7.6% [−19, +4] | −0.8 | −9.6% | −3.6% |
| 0.75–1.00 | 178 ⚠ | 55.6% | 57.7% | 51.4% | +1.0% [−17, +22] | +4.2 | +2.9% | −3.0% |
| 1.00–1.50 | 70 ⚠ | 58.6% | 60.5% | 51.1% | +8.0% [−21, +36] | +7.5 | +13.3% | −1.0% |
| above 1.50 | 14 ⚠ too few | **14.3%** | 62.4% | 50.6% | −73.9% | −36.3 | | |
| 0.35–0.75 (the earlier band) | 1,565 | 55.3% | 54.4% | 52.2% | −0.3% [−7, +7] | +3.2 [−0.3, +7.0] | −4.8% | +6.9% |

**Answers to the Phase 3 questions:**
1. **Win rate:** win rate rises with distance up to 0.55, then flattens. That mostly reflects the price: shorter prices sit further from the line.
2. **Calibration:** ARCHR runs high at every distance except 0.35–0.55 (−2.1, −1.7, +2.8, −4.2, −2.1, −1.9 pts). Above 1.50 it's catastrophic: 14 picks in 3 games, 62% said, 14% won.
3. **Value beyond the price:** only 0.35–0.55 clears zero (+4.6 [+0.4, +7.9]). It's one of seven bands and was +2.0 in discovery, so it doesn't survive multiple-testing control (Phase 4 finds |z| adds nothing as a continuous factor).
4. **CLV:** flat in every band (−0.1 to +0.2 pts).
5. **Overconfidence at the extremes:** yes, from the projection's spread (Phase 7).

**Distance × price.** The 0.35–0.75 band has **not** been shown useful at plus money:

| Plus-money band | Picks | ROI [95%] | Won − no-vig [95%] |
|---|---|---|---|
| \|z\| 0.35–0.75 | 78 | −5.5% [−29, +20] | +0.5 [−10.4, +12.6] |
| Other \|z\| | 547 | −11.6% [−21, −2] | −2.8 |
| \|z\| 0.35–0.75, after the correction only | 25 ⚠ too few | +10.7% [−35, +57] | |

Even the better band lost at plus money. Within minus money it's the band's whole effect: −0.0% vs −8.0% for other distances.

## Phase 4: does anything add information beyond the books?

**The test.** For each factor, fit won ~ offset(logit books' no-vig) + b·x, two ways:
- **In sample:** on all picks, with a game-cluster bootstrap interval and p-value.
- **Chronological:** trained on discovery, judged on the post period's log loss against the books alone.

Benjamini–Hochberg is applied across the 22 prospective factors at q = 0.10.

| Factor | In-sample b [95%] | p | Chronological gain ‰ [95%] | Survives FDR? |
|---|---|---|---|---|
| \|z\| (capped at 2) | +0.079 [−0.146, +0.322] | 0.52 | +0.14 [−0.34, +0.67] | no |
| Plus-money price | −0.098 [−0.268, +0.051] | 0.21 | −0.85 [−2.19, +0.47] | no |
| Vig paid | −0.017 | 0.82 | −0.72 | no |
| ARCHR's chance | +0.160 [−0.066, +0.417] | 0.23 | +0.33 [−1.69, +2.55] | no |
| ARCHR − no-vig disagreement | +0.296 [−0.107, +0.778] | 0.18 | +0.48 [−0.27, +1.34] | no |
| Under | +0.089 [−0.044, +0.223] | 0.17 | −0.41 [−3.57, +3.02] | no |
| Eight market indicators | all p ≥ 0.18 | | points −1.60 [−2.71, −0.50] (hurts) | no |
| Projected minutes | +0.113 | 0.20 | −1.79 | no |
| Confidence score | −0.024 | 0.33 | no training data (graded since Nov 12) | no |
| L5 / L10 / L15 / season hit rate | −0.175 / −0.287 / −0.336 / −0.225 | ≥ 0.23 | +0.23 / +0.40 / +0.46 / +0.25 (all spanning 0) | no |
| Games of history | −0.002 | 0.98 | −0.50 | no |
| Starter share | +0.065 | 0.53 | −0.42 | no |
| Projected − recent minutes | −0.029 | 0.78 | −0.20 | no |
| **Closing-line move (retrospective)** | **+0.367 [+0.102, +0.667]** | **0.015** | −0.96 | (post-game) |
| **Combined** (\|z\|, disagreement, under, minutes change, L10) | | | **−0.06 [−3.06, +3.77]** | no |

- **Injury designation can't be tested.** NBA picks don't record the tag; only NFL ones do.
- **Only the closing-line move predicts outcomes**, and it's known only after the bet. The books' close knows something ARCHR's capture doesn't.
- **Nothing ARCHR knows before tip improves on the books' price.**

## Phase 6: robustness

**Nested chronological split.** Rules came from discovery. The post period is split into **validation** (Nov 12–14 games) and **test** (Nov 15–16 games). Both halves are exploratory: earlier audits had seen them.

| Candidate | Discovery | Validation | Test | Leave one day out (range) | Leave one player out (range) |
|---|---|---|---|---|---|
| Plus money · \|z\| 0.35–0.75 | −13.2% (53) | +8.3% (10 ⚠) | +12.3% (15 ⚠) | −11% … +2% | −8.7% … −1.8% |
| Plus money (all) | −16.7% (367) | −11.1% (116) | +4.6% (142) | −13% … −8% | −11.8% … −10.1% |
| \|z\| 0.35+ (`distance-035-v1`) | −3.5% (1,131) | +3.0% (352) | +6.2% (344) | −2% … +2% | −1.2% … +0.4% |
| \|z\| 0.35–0.75 | −4.8% (964) | +1.9% (295) | +11.7% [−5, +31] (306) | −3% … +2% | −1.2% … +0.7% |
| +100 to +174 · \|z\| 0.35+ | −8.5% (57) | +7.0% (12 ⚠) | −0.9% (17 ⚠) | | |
| Plus money · ARCHR EV > 0 | −13.3% (336) | −9.7% (112) | +5.0% (128) | −11% … −6% | −9.6% … −7.7% |

- **No candidate is positive in all three periods with an interval clear of zero.** The bands that improve after the correction are the ones the post-correction data suggested.
- **No result depends on a single slate or player.** The leave-one-out ranges are narrow, so the losses are broad-based, not one bad night.
- **Is the improvement noise?**
  - |z| 0.35–0.75 after the correction beats no-vig by +6.9 pts [−0.3, +14.0]. The interval only just reaches zero.
  - That's one of roughly 40 band × period readings, after the hypothesis had been seen. Under any multiple-comparison correction it's consistent with noise.
- **The sportsbook-only baseline wins.** Betting every pick at DraftKings loses the vig (−6.5%), and no filter reliably cuts that.

## Phase 7: where the model's errors come from

These cuts use post-game information for **diagnosis only, never as a pregame filter**.

**Variance estimates are too narrow far from the line.** Each pick's standardized error is (actual − projection) / projected SD; a well-calibrated spread gives SD 1 and about 5% outside ±1.96.

| | Picks | SD | Share outside ±1.96 | Bias (actual − projection) |
|---|---|---|---|---|
| All main lines | 6,621 | 1.06 | 5.5% | −0.25 |
| \|z\| below 0.55 | 5,937 | 1.00–1.05 | 4.5–4.9% | |
| \|z\| 0.55–0.75 | 422 | **1.22** | 10.9% | |
| \|z\| 0.75–1.00 | 178 | **1.34** | 12.4% | |
| \|z\| 1.00–1.50 | 70 | **1.44** | 17.1% | −2.16 |
| \|z\| above 1.50 | 14 | 2.13 | 78.6% | +6.0 (3 games: suspect inputs) |
| pts + ast, PRA, pts + reb, points | | 1.08–1.10 | 6.1–6.7% | −0.3 to −0.5 (projections run high) |

**Projected minutes.**
- Mean error is −0.19 min; mean absolute error 4.47 min.
- When he played 6+ minutes short, picks won 40.3% (−26.6% ROI). Within 6 minutes, they won 53.3% and beat no-vig by +2.2 [+0.3, +4.1].
- Overs that came up 6+ minutes short won **23.5%**. Unders that ran 6+ minutes long won **29.1%**.
- Minutes, not projected rate, is the largest controllable source of loss.

**Loss reasons** (all periods, from `lib/tracking/lossReasons`):

| Reason | Overs (1,934 losses) | Unders (1,316 losses) |
|---|---|---|
| Per-minute miss | 50% | 53% |
| Lost by a hair | 25% | 22% |
| Minutes short | 12% | — |
| Blowout | 11% | 1% |
| Minutes long | — | 23% |

**Correlated categories.** A player's props on one night correlate at 0.22. Treating PRA, P+R and points as separate bets multiplies exposure to one minutes outcome.

**Overreliance on recent results.** Hit-rate windows carry no information beyond the price (Phase 4), and 80%+ windows underperform. Nothing suggests leaning harder on them.

**Model fixes, kept separate from betting strategies:**
1. Widen the projection spread as |z| grows, so far-from-line chances aren't overconfident.
2. Model minutes uncertainty into the spread (a mixture over minutes outcomes), not just the mean.
3. Shrink combined-stat projections slightly; they run 0.3–0.5 high.
4. Audit inputs on |z| > 1.5 picks; all 14 came from 3 games.
5. Price the alt rungs from the corrected main-line distribution, not a separate fit.

## Phase 8: six plus-money picks a day?

**Predeclared standards** for main lines. The opposite side was priced on 100% of these picks.

| Standard | Per slate: median (range) | Days with 6+ | Games per slate | ROI [95%] | ARCHR EV, median | Books' EV, median |
|---|---|---|---|---|---|---|
| S0 · any plus-money pick | 55 (28–81) | 11 / 11 | 7 | −10.8% [−19, −3] | +7.3% | **−6.3%** |
| S1 · plus money, ARCHR EV > 0 | 49 (25–73) | 11 / 11 | 7 | −8.5% [−17, −0] | +7.8% | −6.3% |
| S2 · plus money, ARCHR 2+ pts over no-vig | 55 (24–77) | 11 / 11 | 7 | −9.5% [−17, −1] | +7.4% | −6.3% |
| S3 · plus money, \|z\| 0.35+ | 8 (2–18) | 8 / 11 | 5 | −4.8% [−30, +22] | +13.3% | −6.3% |

- **Volume isn't the problem; edge is.** Six plus-money candidates exist on every slate under S0–S2, but each standard lost money, and the books' expected value on them is −6.3% throughout. Only S3 is selective, and it reaches six on just 8 of 11 days, across about 5 games.
- **Single bets aren't profitable, so parlays aren't evaluated.** If singles were profitable, a parlay's joint chance would need the 0.22 same-player and 0.016 same-game correlations, not a product of marginals.
- **A high payout is not positive expected value.** ARCHR's +7–13% expected value on these picks is the miscalibration from Phase 2.

## Table A: plus-money candidates for forward testing

Evidence strength: strong, moderate, weak or none.

| Filter (exact) | Historical sample | Out-of-sample ROI [95%] | Calibration · CLV | Per slate | Evidence | Ready to test forward? |
|---|---|---|---|---|---|---|
| **`distance-035-v1`**: ARCHR's side, projection 0.35+ past the line, any price | 1,827 picks (80 games) | post +4.6% [−7, +18]; all −0.4% [−7, +6] | +0.2 pts · 0.0 | 171 (median, post) | **weak** | **yes**: already frozen with every pick since Nov 17 |
| \|z\| 0.35–0.55, any price | 1,143 | post +10.1% [−2, +24]; discovery −2.8% | +2.8 · −0.1 | not computed (the run reports per-slate counts for \|z\| 0.35–0.75 only: median 146 after the correction) | weak (one band among many) | yes, as a pre-registered sub-band |
| Plus money · \|z\| 0.35–0.75 | 78 | post +10.7% [−35, +57] (25 ⚠) | −9.3 · +0.6 | 7 | **none** (too few) | track only; needs about 1,000 picks |
| Plus money (+100 and higher), ARCHR's side | 625 | post −2.4% [−16, +11] | **−9.3** · +0.4 | 55 | none (negative) | no |

## Table C: filters to reject

| Filter | Why it's rejected |
|---|---|
| "Most accurate" (L5 80%+ · unders · −200…+100 · min 24+) | Failed out of sample: 49.6%, −12.0% (`performance-audit.md`) |
| Unders base / "unders outperform" | Gap vanished out of sample; not significant once adjusted |
| L5 / L10 / L15 / season hit-rate bars | No information beyond the price (Phase 4); 80%+ buckets underperform |
| Plus money with ARCHR EV > 0 | −8.5%. ARCHR's EV at plus money is miscalibration (−9.3 pts). |
| Plus money with ARCHR 2+ pts above no-vig | −9.5%. Disagreement isn't value (Phase 4). |
| Cautious edge > 0 | Worse than negative cautious edge in discovery; too few after |
| Confidence grade | Can't be validated: grades only since Nov 12, almost all C or D |
| Under 0.20 or 0.20–0.35 distance as a *positive* filter | Consistent losers (−9.4%, −7.6%); they belong in an exclusion, already covered by `distance-035-v1` |
| \|z\| above 1.50 | 14 picks, 3 games, 14% won: an input problem, not a filter |
| Projected minutes, role, history, minutes change | No incremental information (Phase 4) |
| Every market indicator | No incremental information; "points" hurts out of sample |
| Alternate lines (straight) | −13.6% [−21, −6]; ARCHR overstates them by 7 pts |

## Table D: missing data and instrumentation, in priority order

| # | What to collect | Why it matters |
|---|---|---|
| 1 | **Forward settlements of predeclared rules** (already running: `distance-035-v1`, the screener sets) | The only untouched data. Nothing can be confirmed without it. |
| 2 | **Prices from more books** (Odds API or another feed) at capture and close | Today it's DraftKings alone. Line shopping is where small edges live, and a real no-vig consensus beats one book's. |
| 3 | **Opening prices** and the full quote path | Most closes don't move from capture (CLV ≈ 0). Movement from the open separates sharp and soft lines. |
| 4 | **Injury and lineup status** frozen with each NBA pick | Not stored for NBA picks. Minutes misses are the largest loss source. |
| 5 | **Actual minutes distribution** (not just the mean) in the projection | Phase 7: misses of 6+ minutes swing win rates by 25+ points. |
| 6 | **Frozen screener records and sets** (started Nov 17) | Removes the "rebuilt" caveat from every record-based cut. |
| 7 | **Dependence model** for a player's props on one night | 0.22 correlation; required before any multi-pick product |
| 8 | **Opposite quote at alt lines** (poll both sides of the ladder) | Alt fades are untestable at 8.5% coverage. |
| 9 | **Longer horizon** | 11 slate days of early-season NBA. Effects of 2–3 pts need about 2,000+ picks per segment. |

## Research roadmap

1. **Now:** keep `distance-035-v1` and the |z| 0.35–0.55 sub-band frozen with every pick, and change nothing else. Re-run `audit:plus-money` and `audit:performance` weekly, and judge the rules **only on picks frozen after Nov 17**.
2. **Model fixes,** which need separate approval and their own backtest and forward check:
   - widen the spread with |z|;
   - fold minutes uncertainty into the spread;
   - shrink combined-stat means;
   - investigate the |z| > 1.5 inputs.
3. **Data:** a second book's prices and opening lines, then injury and lineup state at capture.
4. **Only after a single-bet edge holds up forward** (an ROI interval above zero on untouched data) consider a daily shortlist, and only then parlays with a dependence model.

## Reproduce

Model lab → `audit:plus-money` (read-only):
- `scripts/audit-plus-money.ts`: the script;
- `scripts/props/nbaAuditRows.ts`: the row loader shared with `audit:performance`;
- `src/lib/audit/plusMoney.ts`: pure and tested; buckets, the opposite-quote lookup, the fade row, the chronological factor test, leave-one-out, concentration, slate feasibility and residual correlation;
- `src/lib/audit/performance.ts`: metrics, cluster bootstrap, offset logistic, Benjamini–Hochberg.
