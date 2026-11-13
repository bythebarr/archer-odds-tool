# Confidence: continuous-factor diagnosis (no scoring change)

Diagnosis only. No grade cut, weight or scoring rule changed, and nothing the product shows changed. The continuous variant lives in `src/lib/propModel/confidenceContinuous.ts`, which no product code imports.

**Source.** Model lab run #87, `backtest:confidence`, production DB, branch `sam/confidence-continuous` at `342189c`, 2026-11-13.

**Two data sets:**
- **The closing-price backtest:** 700 NBA sides with settled outcomes. The report card at the time can't be reconstructed, so the track factor is neutral in both scorings.
- **The frozen board:** today's screener rows, with prices as the feed last polled them (Nov 1). It covers 2,460 NBA and 1,844 NFL main lines.

## Verdict

1. **Continuous factors spread the scores out, but they don't make A reachable, and they don't show the score predicting outcomes.**

   **Distinct scores, current → continuous:**

   | Data set | Current | Continuous |
   | --- | --- | --- |
   | Backtest | 13 | 219 |
   | NBA board | 12 | 386 |
   | NFL board | 11 | 332 |

   **Top score, current → continuous:**

   | Data set | Current | Continuous |
   | --- | --- | --- |
   | Backtest | 75 | 73.9 |
   | NBA board | 70 | 70.5 |
   | NFL board | 55 | 59.9 |

   **A stays out of reach on the live board under both scorings.** No NBA or NFL blend card is `trusted`. Under continuous track, every prop card is graded on 54 outcomes or fewer, so even the best-scoring cards earn only a fraction of the +10.

2. **Calibration: the score does not separate outcomes on this data, under either scoring.**
   - Only two 10-point buckets have 30+ positive-edge bets (40s and 50s). The check needs three, so the script's verdict is **TOO FEW BETS TO SAY** for both.
   - **The buckets that can be read don't rise with the score.**
     - Current: the 40s return −27.5%, the 50s −2.4%, the 60s −16.9% (16 bets) and the 70s −16.7% (11 bets).
     - Continuous: the 40s return −28.2%, the 50s −4.9%, the 60s −2.3% (23 bets) and the 70s −45.2% (3 bets).
   - There is no evidence yet that a higher score earns a better realized ROI. The score is not shown to predict.

3. **The z guard is needed, whatever else changes.** On today's board the distance factor credits +10 to rows whose projection spread has collapsed to ~0:
   - **NBA:** 139 rows, e.g. an Andre Drummond "double-double: yes" prop at z = −465,369.5.
   - **NFL:** 35 rows, e.g. "anytime TD: yes" props at z ≈ −11.

   These are yes/no props scored as if their projection had a real spread. The bug is the same as the "499421.22 of a typical swing" reason text.

   **Fix:** treat |z| > 6 as a degenerate input (no distance credit, and say so), and cap |z| at 2.5 otherwise. The continuous variant does this. The backtest had no degenerate rows, because those sides all have real spreads.

4. **Most of the board's movement comes from two choices Sam should rule on before any scoring change.** They are not "continuous" by necessity.
   - **Track.** A thin card's flat −5 becomes its actual record weighted by sample. Every prop card on file is graded on 54 outcomes or fewer, so its weight is about 0.1 at most, whatever its skill. Nearly every prop therefore moves from −5 to about 0. That alone lifts the board about 5 points, and it is most of why NBA D falls from 47.5% to 31.8%.
     - If the intent is that a not-yet-earned card still costs something, the continuous track needs a floor (e.g. −5 at n = 0, rising to the record as n grows), not a weight toward 0.
   - **Market past 15 pts.** The −15 cliff at a 15-pt gap became a ramp from 0 at 15 pts to −15 at 22 pts. Every one of the five biggest NBA movers sits just past 15 pts: Durant, Clingan, Tyson and Avdija move about +19 because −15 became −0.1 to −1.2.
     - Whether the cost should start at 15 or ramp in from 12 is a judgment call. The audit's evidence ("past 15 pts was its worst") doesn't say how sharp the edge is.

## Before vs after

### Closing-price backtest (700 NBA sides, track neutral)

| | Distinct | Max | A | B | C | D |
| --- | --- | --- | --- | --- | --- | --- |
| Current | 13 | 75 | 0.4% (3) | 10.9% (76) | 71.6% (501) | 17.1% (120) |
| Continuous | 219 | 73.9 | 0.0% (0) | 7.0% (49) | 76.1% (533) | 16.9% (118) |

Score distribution (10-point buckets, 0s→90s):
- Current: `0 · 10 · 18 · 36 · 270 · 287 · 60 · 19 · 0 · 0`
- Continuous: `0 · 10 · 19 · 34 · 273 · 315 · 45 · 4 · 0 · 0`

### Frozen board, NBA main lines (2,460)

| | Distinct | Max | A | B | C | D |
| --- | --- | --- | --- | --- | --- | --- |
| Current | 12 | 70 | 0% | 5.2% (129) | 47.3% (1,163) | 47.5% (1,168) |
| Continuous | 386 | 70.5 | 0% | 9.2% (226) | 59.0% (1,452) | 31.8% (782) |

Score distribution:
- Current: `0 · 3 · 162 · 335 · 1206 · 625 · 128 · 1 · 0 · 0`
- Continuous: `1 · 11 · 60 · 325 · 1080 · 757 · 223 · 3 · 0 · 0`

### Frozen board, NFL main lines (1,844)

Every NFL row is unpriced on the frozen feed: −10 in both scorings.

| | Distinct | Max | A | B | C | D |
| --- | --- | --- | --- | --- | --- | --- |
| Current | 11 | 55 | 0% | 0% | 14.4% (265) | 85.6% (1,579) |
| Continuous | 332 | 59.9 | 0% | 0% | 24.5% (452) | 75.5% (1,392) |

## The rows that move most

Each entry gives the score (current → continuous), then the factors that moved under each scoring.

**Backtest (largest moves +7 to +8):**
- 2026-10-27 points over @ +100: C 50 → C 58.3.
  - Current: side −5.
  - Continuous: sample +3.3, distance +5, side −5.
- assists under @ −142: C 55 → B 62.7.
  - Current: nothing moved.
  - Continuous: sample +2.3, market +1.7, distance +3.7.
- pointsRebounds over @ +101: D 40 → C 47.6.
  - Current: distance −10, side −5.
  - Continuous: sample +2.3, market +0.3, distance −5, side −5.
- pointsRebounds under @ −115: C 45 → C 52.3.
  - Current: distance −10.
  - Continuous: sample +2.3, distance −5.
- reboundsAssists under @ −125: C 45 → C 51.8.
  - Current: distance −10.
  - Continuous: sample +2.3, market +0.2, distance −5.7.

**NBA board (+19 each, all from the market ramp plus track):**
- Kevin Durant over 2.5 STK (+265): D 20 → D 39.6.
  - Current: track −5, sample +5, market −15, distance −10, side −5, price −5.
  - Continuous: track −0.1, sample +5, market −1, distance −9.3, side −5, price −5.
- Donovan Clingan under 1.5 AST (+137): D 25 → D 44.5.
  - Current: track −5, sample +5, market −15, distance −10, price −5.
  - Continuous: track −0.4, sample +5, market −0.1, distance −10, price −5.
- Jaylon Tyson over 24.5 P+A (+980): D 40 → C 59.
  - Current: track −5, sample +5, market −15, distance +10, side −5, price −5.
  - Continuous: track −0.2, sample +5, market −0.8, distance +10, side −5, price −5.
- Deni Avdija over 2.5 STL (+750): D 40 → C 59.
  - Current: track −5, sample +5, market −15, distance +10, side −5, price −5.
  - Continuous: track +0.2, sample +5, market −1.2, distance +10, side −5, price −5.
- Jerami Grant over 1.5 3PM (+105): D 25 → D 43.9.
  - Current: track −5, sample +5, market −15, side −5, minutes −10.
  - Continuous: track +0.9, sample +5, market −4.4, distance +2.4, side −5, minutes −10.

**NFL board (TD "yes" props lose the degenerate +10; sample becomes linear):**
- Brayden Willis TD yes: C 50 → D 33.3.
  - Current: track −5, distance +10, price −10.
  - Continuous: track −5, sample −6.7, price −10.
- DeeJay Dallas TD yes: C 50 → D 34.7.
  - Current: track −5, distance +10, price −10.
  - Continuous: track −5, sample −5.3, price −10.
- Dont'e Thornton Jr. TD yes: C 50 → D 34.7.
  - Current: track −5, distance +10, price −10.
  - Continuous: track −5, sample −5.3, price −10.
- Brevin Jordan TD yes: D 25 → D 10.5.
  - Current: track −5, sample −10, distance +10, injury −15, price −10.
  - Continuous: track −5, sample −14.5, injury −15, price −10.
- Blake Corum over 71.5 R+R YDS: D 30 → D 44.5.
  - Current: track −5, distance −10, price −10.
  - Continuous: track −0.1, sample +4.7, distance −5.1, price −10.

## Calibration: realized ROI by 10-point bucket (closing-price backtest)

ROI is that of the positive-edge bets at the closing price, flat stakes. A bucket needs 30+ such bets to count toward the verdict.

| Bucket | Current: n · edge bets · ROI | Continuous: n · edge bets · ROI |
| --- | --- | --- |
| 10–19 | 10 · 2 · +105.6% | 10 · 2 · +105.6% |
| 20–29 | 18 · 9 · +33.5% | 19 · 8 · +26.5% |
| 30–39 | 36 · 7 · −37.5% | 34 · 8 · −21.6% |
| 40–49 | 270 · **63** · **−27.5%** | 273 · **61** · **−28.2%** |
| 50–59 | 287 · **106** · **−2.4%** | 315 · **109** · **−4.9%** |
| 60–69 | 60 · 16 · −16.9% | 45 · 23 · −2.3% |
| 70–79 | 19 · 11 · −16.7% | 4 · 3 · −45.2% |

**Verdict, both scorings: TOO FEW BETS TO SAY.** Only two buckets have 30+ edge bets; the check needs three. As far as the data reaches, a higher score does not earn a better ROI, so this report does not claim that the score predicts.

## Continuous factors as scored here

All four keep the live factor's range. Same base (55) and cuts (A 75 / B 60 / C 45).

| Factor | Live | Continuous (diagnosis) |
| --- | --- | --- |
| Distance | −10 at \|z\| < 0.35, +10 at ≥ 0.75 | Linear: −10 at 0.15, 0 at 0.55, +10 at 0.95. \|z\| capped at 2.5. \|z\| > 6 = degenerate, 0. |
| Market | +5 at 8–15 pts, −15 past 15 | Tent: 0 at 3, +5 at 11.5, 0 at 15. Then a ramp to −15 at 22. |
| Sample | −20 / −10 / 0 / +5 by game buckets | Linear: −20 at 2, −10 at 7.5, 0 at 15, +5 at 30. |
| Track | +10 trusted, −5 otherwise | Card skill (Brier pts ×1000), clamped −5..+10, × min(1, n/500). No card −5; no blend 0. |

## What this does not cover

- **The live leans with frozen grades.** They store the grade, not the inputs, so they can't be re-scored.
- **Report-card verdicts at the time of each backtest game.** These can't be reconstructed, so track is neutral in the backtest.

The scoring change itself (continuous factors in `confidence.ts`, the same cuts, and dropping the verdict-word stamps for "score · N graded") waits on Sam's go, per the plan.

## Reproduce

Model lab, `backtest:confidence`, on this branch. It is read-only. It exits non-zero by design whenever a verdict is DATA REQUIRED or NOT VALIDATED.
