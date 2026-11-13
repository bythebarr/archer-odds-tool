# The z pocket for picks: sweep

Measurement only. No gate is implemented, and no pricing, gating, scoring, `CAUTIOUS_READ_MODE`, `MIN_GATE_SAMPLES`, capture, cut or `BASE` changed.

**Source.** Model lab run #89, `audit:factors`, production DB, branch `sam/z-pocket` at `10b48dc`, 2026-11-13.

**Definitions.**
- |z| = |projection − line| / the projection's spread.
- The bets are ARCHR's **positive-edge** sides (ARCHR's chance above the price's implied chance), at flat stakes.
- "Early" and "late" split each set by date at its midpoint.
- Intervals are 95%.
- |z| > 6 is a collapsed projection spread (yes/no props). It is reported apart and kept out of every threshold.

**Three data sets.**
- **NBA and NFL prop backtests at closing prices.** These are small: 214 and 130 edge bets.
- **Tracked live NBA prop leans.** These are settled at the price when the lean was captured, not the close. This is the big sample (2,863 edge bets) and the source of the anchors: near-line −18.6% on 1,614 bets, far +11.8% on 205.
- **Tracked NFL leans** carry no price (number-only), so they have no edge bets to sweep.

## Recommendation

**One threshold: |z| ≥ 0.75.**

In the live NBA leans it is the lowest floor that is positive in both halves:

| | Value |
|---|---|
| ROI | +11.2% [−3, +25] |
| Edge bets | 231 (8% of all) |
| Early half | +14.0% |
| Late half | +7.7% |

Every lower floor loses in at least one half:

| Floor | ROI | Early | Late |
|---|---|---|---|
| 0.65 | 0.0% | −7.5% | +10.2% |
| 0.55 | +3.6% | −7.5% | +17.8% |
| 0.35 | −0.4% | −6.2% | +5.1% |

Do not read more into it than the data holds:
- **Not significant.** The interval still crosses zero (lower bound −3%).
- **Not confirmed at closing prices.** The closing-price backtests are too small past 0.55 to confirm or refute it. The NBA backtest's 0.75+ is −8.9% on 14 bets; the NFL backtest's is +6.5% on 50.
- **No stable floor.** The script's strict check (every bucket from the floor up returns ≥ 0 in both halves, with 30+ bets a half) finds none in any set. The 0.65–0.75 bucket dips in the live leans, and the backtests are too thin.

**Ceiling: not recommended yet.** Above 1.25 the live leans turn negative (−9.1%) but on 22 bets (+1.9% early, −38.5% late). The 0.75–1.25 band (+13.4% on 209, +15.7% / +10.6%) edges out 0.75+ only by dropping those 22. That fits the gap evidence ("very far off is a trap") but doesn't prove it. Re-run once more leans settle.

## The volume-vs-ROI tradeoff (live NBA leans, all floors, no ceiling)

| Floor | Edge bets kept | Share | ROI [95%] | Early | Late | Both halves ≥ 0? |
|---|---|---|---|---|---|---|
| none | 2,863 | 100% | −11.7% [−16, −7] | −13.4% | −10.1% | no |
| 0.35 | 1,082 | 38% | −0.4% [−8, 7] | −6.2% | +5.1% | no |
| 0.55 | 511 | 18% | +3.6% [−6, 14] | −7.5% | +17.8% | no |
| 0.65 | 345 | 12% | +0.0% [−11, 12] | −7.5% | +10.2% | no |
| **0.75** | **231** | **8%** | **+11.2% [−3, 25]** | **+14.0%** | **+7.7%** | **yes** |
| 0.85 | 146 | 5% | +5.9% [−12, 24] | +13.6% | −2.7% | no |
| 0.95 | 90 | 3% | +3.4% [−18, 25] | +15.8% | −12.0% | no |
| 1.25 | 22 | 1% | −9.1% [−53, 34] | +1.9% | −38.5% | no |

With a 1.25 ceiling, 0.75–1.25 keeps 209 bets (7%) at +13.4% [−2, 28], +15.7% early and +10.6% late.

## Per bucket

Each entry reads: bets · ROI (early bets · ROI | late bets · ROI).

### Live NBA leans (price at capture)

| \|z\| | Edge bets · ROI [95%] | Early | Late |
|---|---|---|---|
| 0–0.15 | 807 · −22.0% [−31, −13] | 376 · −25.1% | 431 · −19.2% |
| 0.15–0.35 | 974 · −15.6% [−24, −8] | 449 · −12.1% | 525 · −18.7% |
| 0.35–0.55 | 571 · −4.0% [−14, 6] | 240 · −4.6% | 331 · −3.5% |
| 0.55–0.65 | 166 · +11.2% [−8, 30] | 88 · −7.4% | 78 · +32.2% |
| 0.65–0.75 | 114 · −22.7% [−42, −4] | 69 · −47.7% | 45 · +15.8% |
| 0.75–0.85 | 85 · +20.3% [−4, 44] | 52 · +14.5% | 33 · +29.5% |
| 0.85–0.95 | 56 · +9.9% [−20, 40] | 27 · +9.6% | 29 · +10.2% |
| 0.95–1.25 | 68 · +7.5% [−18, 33] | 34 · +22.3% | 34 · −7.3% |
| 1.25+ | 22 · −9.1% [−53, 34] | 16 · +1.9% | 6 · −38.5% |

### NBA props backtest (closing prices)

| \|z\| | Edge bets · ROI | Early | Late |
|---|---|---|---|
| 0–0.15 | 66 · −1.6% | 37 · +10.0% | 29 · −16.3% |
| 0.15–0.35 | 70 · −20.7% | 37 · −16.5% | 33 · −25.4% |
| 0.35–0.55 | 42 · −14.3% | 14 · −7.8% | 28 · −17.5% |
| 0.55–0.65 | 11 · −13.4% | 5 · −25.3% | 6 · −3.5% |
| 0.65–0.75 | 11 · +21.5% | 4 · −100% | 7 · +90.9% |
| 0.75–0.85 | 7 · −19.4% | 2 · −100% | 5 · +12.9% |
| 0.85–0.95 | 5 · +6.3% | 3 · −45.2% | 2 · +83.5% |
| 0.95–1.25 | 2 · −10.0% | 1 · −100% | 1 · +80.0% |
| 1.25+ | 0 | — | — |

### NFL props backtest (closing prices; z now computed on these sides)

| \|z\| | Edge bets · ROI | Early | Late |
|---|---|---|---|
| 0–0.15 | 17 · +11.4% | 11 · +13.9% | 6 · +6.8% |
| 0.15–0.35 | 35 · −5.8% | 16 · +1.2% | 19 · −11.7% |
| 0.35–0.55 | 17 · +15.7% | 11 · −5.2% | 6 · +53.9% |
| 0.55–0.65 | 6 · +24.5% | 0 | 6 · +24.5% |
| 0.65–0.75 | 5 · −27.9% | 2 · −100% | 3 · +20.1% |
| 0.75–0.85 | 2 · +70.8% | 0 | 2 · +70.8% |
| 0.85–0.95 | 2 · −5.8% | 1 · −100% | 1 · +88.5% |
| 0.95–1.25 | 10 · +17.4% | 4 · +47.4% | 6 · −2.6% |
| 1.25+ | 36 · +0.6% | 21 · −27.3% | 15 · +39.6% |
| degenerate (>6) | 60 · +1.1% | 23 · −10.6% | 37 · +8.4% |

### NBA + NFL backtests pooled (closing prices)

| \|z\| | Edge bets · ROI | Early | Late |
|---|---|---|---|
| 0–0.15 | 83 · +1.1% | 55 · −4.3% | 28 · +11.6% |
| 0.15–0.35 | 105 · −15.8% | 62 · −14.0% | 43 · −18.3% |
| 0.35–0.55 | 59 · −5.7% | 35 · −2.6% | 24 · −10.2% |
| 0.55–0.65 | 17 · −0.0% | 9 · −14.6% | 8 · +16.3% |
| 0.65–0.75 | 16 · +6.1% | 8 · −4.0% | 8 · +16.1% |
| 0.75–0.85 | 9 · +0.7% | 5 · −26.1% | 4 · +34.2% |
| 0.85–0.95 | 7 · +2.9% | 5 · +6.3% | 2 · −5.8% |
| 0.95–1.25 | 12 · +12.9% | 2 · −10.0% | 10 · +17.4% |
| 1.25+ | 36 · +0.6% | 0 | 36 · +0.6% |

Pooled thresholds:

| Floor | ROI | Bets | Early | Late |
|---|---|---|---|---|
| 0.35+ | −0.2% | 156 | +2.2% | −1.7% |
| 0.55+ | +3.1% | 97 | −9.7% | +8.5% |
| 0.75+ | +3.1% | 64 | −9.9% | +6.2% |

None are positive in both halves. (The pooled halves split by date across both sports. The NFL sides are mostly later, so the pooled early half is almost all NBA.)

## What this says

1. **Near the line is a trap, and every source agrees.** In the live leans, |z| < 0.35 loses 15–22% in both halves, on 1,781 bets. In both backtests, 0.15–0.35 is the worst or near-worst bucket.
2. **The floor sits near 0.75, not 0.35.** The 0.35–0.75 band does not earn its keep:
   - 0.35–0.55 still loses in both halves.
   - 0.55–0.75 swings hard between halves.
3. **A ceiling is plausible but unproven.** It would sit at 1.25, with 22 live bets above it. Re-check after more leans settle.
4. **The closing-price backtests are too small to pick a threshold from.** Their past-0.55 buckets hold 2–17 bets each. Use them as a sign check only.

## Next

The gate itself (keep ARCHR's picks only at |z| ≥ the chosen floor) is a follow-up after Sam picks the point on the curve. To reproduce, run Model lab `audit:factors` on this branch.
