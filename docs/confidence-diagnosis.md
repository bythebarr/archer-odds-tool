# Confidence grade: why it lands B–D

Diagnosis only: no grade cut, weight or scoring rule changed. Source: Model lab run #84, `backtest:confidence` (`SAVE_REPORT=1`, production DB), branch `sam/one-number` at `b68b2ee`, 2026-11-13.

## Verdict

**A is unreachable by construction today, not miscalibrated.**

- The only +10 that can lift a prop to 75 is a passing report card for its stat ("track"). Every NBA blend card is `thin`, and every NFL card is `thin` or `unproven`. So every NBA and NFL prop takes −5 there.
- The highest score the rules then allow is 55 − 5 + 5 (30+ games) + 5 (8–15 pts above the books) + 10 (projection far off the line) = **70**, under the A cut of 75.
- On tonight's board the highest real NBA score was 69, and NFL topped out in the 55–59 bucket.

New cuts can't be fitted honestly yet. Fitting them needs graded picks the weights never saw: leans that froze a grade and then settled. **None have settled yet** (see "Frozen grades" below). Moving cuts on the closing-price replay would fit cuts to the same data the weights came from.

**Proposal (not built):**

1. Show the 0–100 score beside the letter everywhere the grade appears ("B 69", "C 46"), so a 69 B reads differently from a 60 B, and a 54 C from a 45 C.
2. Put a distribution line on /models: the share of tonight's board at each grade and the highest score reached. Add a plain note that A needs a stat with a passing report card, and none has one yet.
3. Revisit cuts only once 100+ frozen A/B picks and 100+ C/D picks have settled.

## Closing-price replay: per grade

These are 700 NBA sides at closing prices. The weights were set partly from this data, so this table is in-sample.

| Grade | n | Mean ARCHR | Hit rate | Brier | Edge bets | Edge ROI [95%] |
| --- | --- | --- | --- | --- | --- | --- |
| A | 3 | 61.3% | 0.0% | 0.3752 | 3 | −100.0% |
| B | 76 | 49.3% | 50.0% | 0.2431 | 24 | −6.5% [−44.9%, +32.0%] |
| C | 501 | 50.7% | 50.9% | 0.2494 | 144 | −8.4% [−24.3%, +7.6%] |
| D | 120 | 47.4% | 47.5% | 0.2381 | 43 | −12.3% [−43.9%, +19.3%] |

Verdict: DATA REQUIRED. A+B has 79 sides and 27 edge bets; each side of the split needs 100+ sides and 50+ edge bets.

The replay can't rebuild the report card at the time, injury tags or alt rungs. It leaves those neutral, so the replay can show the 3 A's that the live board can't.

## Frozen grades: settled leans since 2026-11-12

**0 settled.** Capture skips games it has already frozen (`src/lib/tracking/capture.ts`, "minus those this model already captured"). The 2026-11-12 games were most likely frozen before the grade-recording deploy (about 22:35 UTC). The first graded picks are tonight's games. The script prints the per-grade and per-score-bucket outcome tables automatically once they settle.

## Live board, graded exactly as the screener grades it

| Board | Rows | A | B | C | D | Highest score |
| --- | --- | --- | --- | --- | --- | --- |
| NBA main lines | 2,191 | 0 | 100 (4.6%) | 1,043 (47.6%) | 1,048 (47.8%) | 65–69 |
| NBA alt rungs | 1,086 | 0 | 0 | 389 | 697 | 55–59 |
| NFL main lines | 1,859 | 0 | 0 | 272 | 1,587 | 55–59 |
| NFL alt rungs | 1,182 | 0 | 0 | 7 | 1,175 | 45–49 |

### What costs the most (NBA main lines, 2,191 rows)

| Factor | Rows moved | Mean pts | Biggest cost on | Grades changed without it |
| --- | --- | --- | --- | --- |
| Report card not passing (track) | 100% | −5.0 | 664 | 923 |
| Projection near the line (distance) | 78.5% | −5.6 net (−10 near, +10 far) | 1,221 | 901 |
| NBA over (side) | 61.7% | −5.0 | 0 | 682 |
| Long price +130 and up | 20.4% | −5.0 | 0 | 189 |
| Injury tag | 9.2% | −15.0 | 166 | 96 |
| Minutes in flux or small role | 6.8% | −9.0 | 57 | 77 |
| Record doesn't back it | 7.0% | −5.0 | 0 | 56 |
| Gap to the books (market) | 11.9% | −0.2 | 68 | 125 |
| 30+ games of history (sample) | 86.9% | +4.9 | 15 | 581 |

On NFL, a missing price costs −10 on every row (see (b) below), and "barely clears the line" is the biggest cost on 796 of 1,859 main lines.

The +5 for being 8–15 pts above the books almost never fires on NBA now. Since the side correction (#113), ARCHR's NBA chance sits close to the books' price.

### Three real rows, every factor (NBA main lines tonight)

| | James Harden over 3.5 STL (+1760) | Landry Shamet over 2.5 REB (+122) | Tyler Herro over 26.5 P+A (−115) |
| --- | --- | --- | --- |
| Grade, score | **B 60** | **C 50** | **D 40** |
| Base | 55 | 55 | 55 |
| Report card (track) | −5 | −5 | −5 |
| History (sample) | +5 (97 games) | +5 (80) | +5 (45) |
| Record | 0 (0/10, price implies 5%) | 0 (1/10, implies 45%) | 0 (5/10, implies 53%) |
| Gap to books (market) | +5 (8 pts above) | 0 | 0 |
| Distance from line | +10 (2.06 swings) | 0 (0.51) | −10 (0.23) |
| NBA over (side) | −5 | −5 | −5 |
| Minutes | 0 (34.8 projected) | 0 (27.3) | 0 (31.4) |
| Long price | −5 | — | — |
| **Biggest cost** | report card (tied with side and price at −5) | report card (tied with side) | distance from line |

The B example shows the grade's blind spot. A +1760 steals over with a 0/10 record scores B, because the far-from-line, gap and history bonuses outweigh the costs.

## The two inconsistencies

**(a) A missing report card scores −5 on the sheet.** The sheet passes `blendVerdicts[stat] ?? null` and the pools pass `propBlendVerdict(...)`. Both give `null` for a blend-priced stat with no card, so **sheet and pool agree on all 6,318 NBA and NFL rows (0 differ)**.

The real inconsistency is elsewhere. A stat with no card at all is treated like one with a failing card (−5), while non-blend sports get a neutral 0. This hits:
- NBA double-double and triple-double: 135 rows, of which 74 would change grade if scored neutral. Example: Josh Hart DD, C 55 → B 60.
- NFL anytime TD: 305 rows, of which 90 would change grade. Example: Hunter Henry TD, D 40 → C 45.

**(b) No price costs −10.** NBA: 0 of 3,277 rows lack a price, so it changes nothing. NFL: **3,041 of 3,041 rows carry no price** on the board. The −10 lands on every NFL prop, and 1,187 grades would change without it. Example: Jared Goff PASS YDS, D 40 → C 50.

This matches the earlier finding that NFL tracked props carry no prices. Before touching the rule, it's worth checking whether the books haven't priced NFL props midweek or the NFL screener source drops prices.

## Not touched

`CAUTIOUS_READ_MODE`, `MIN_GATE_SAMPLES`, the grade cuts, every weight, and all pricing code are unchanged. The only code change splits `poolConfidenceInput` out of `poolConfidence`, so the script grades rows with the same inputs as the pools.
