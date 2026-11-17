# ARCHR Edge: contrarian fade audit

This is measurement only. Nothing in pricing, calibration, selection, grading or recommendations changed.

**Source.** Model lab run #102 (`audit:plus-money`), production database, 2026-11-17. See also [`plus-money-alpha-audit.md`](plus-money-alpha-audit.md).

## Bottom line

**No fade is profitable, and no fade hypothesis survives chronological validation.**
- Fading every ARCHR main-line pick at the actual opposite price returned −5.4% [−9%, −2%].
- Each hypothesis A–E lost money or was too small to read.
- Where ARCHR is weak (overconfident far projections, plus-money overs, alt rungs), the books are already right. The opposite side pays the vig like any other bet.

## How fades were priced

For each original ARCHR main-line pick:

1. **The exact pick:** its game, player, stat, side and line, as frozen before tip.
2. **The opposite side's actual price:** DraftKings' quote on the other side of the **same line**, from `NbaPropSnapshot`. That's the latest poll at or before the pick's decision time (median 0.35 h before capture).
3. **Identity:** same game, player, stat, line and book. The pick's own side at that moment must match the price recorded with the pick. Mismatches (388, mostly re-polls between quote and capture) are **left out**, not repriced.
4. **Settlement:** the opposite side wins exactly when the pick lost. Main lines are half-points, so there were no pushes; voids (DNPs) are set aside, as the book voids them.
5. **ROI:** flat stakes at the opposite side's recorded price, with game-cluster bootstrap intervals.
6. **Baseline:** won minus the opposite side's no-vig chance from the same recorded pair.
7. **CLV:** the opposite side's no-vig move from the decision quote to the last pre-tip quote.
8. **Chronology:** discovery (before the Nov 12 correction) vs after it. Both are exploratory: the hypotheses came from audits that had seen both periods.

**Nothing was reconstructed.** The arithmetic reconstruction from the stored no-vig chance agrees with the recorded quotes exactly, but it's used for no result. No present-day quote is substituted, and no symmetric odds are assumed.

## Table B: fade hypotheses

| Hypothesis (original ARCHR condition) | Opposite priced | Fades | Fade ROI [95%] | Won − no-vig [95%] | Fade CLV | Discovery → post | Why it may fail | Evidence |
|---|---|---|---|---|---|---|---|---|
| **Baseline:** fade every main-line pick | 94% | 6,232 (80 games) | −5.4% [−9, −2] | +0.5 [−1.5, +2.4] | +0.0 | −3.7% → −8.2% | Pays the vig both ways | none |
| **A:** \|z\| above 0.75 (≤ 6) | 97% | 253 (54 games) | −12.1% [−33, +7] | −2.9 [−13.8, +7.2] | +0.1 | −15.7% → −5.5% | ARCHR is overconfident there, but the books price it. Far projections still win 54%. | none |
| **B:** L10 above 80% (8+ games) | 96% | 125 (51 games) ⚠ small | −2.9% [−19, +14] | +1.5 [−6.7, +10.1] | −0.3 | −6.6% → +6.7% (35 ⚠) | The books already discount hot records (Phase 4). The positive post number is 35 picks. | none |
| **C:** alternate lines, fade at the same line | **8.5%** (211 of 2,471) | 211 | +5.1% [−7, +17] | +4.2 [−3.1, +11.1] | — | — | **Untestable as a strategy.** Opposite quotes exist only where DraftKings hung both sides of that rung: a selected 8.5%, no closing pairs. | **untestable** |
| **C2:** alternate-line overconfidence, fade the *main line* instead (a different bet) | 95% | 2,357 (73 games) | −1.7% [−7, +4] | +2.5 [−0.4, +5.2] | +0.3 | +0.0% → −6.8% | It's not the alt bet. The main-line opposite has its own price and is near break-even at best. | none |
| **D:** assists, PRA, reb + ast | 94% | 2,082 (80 games) | −3.7% [−9, +2] | +1.5 [−1.1, +4.2] | +0.0 | −3.2% → −4.5% | ARCHR's errors there are small (−1.5 pts vs no-vig); the vig is bigger. | none |
| **E:** ARCHR 5+ pts from no-vig | 95% | 1,452 (79 games) | −6.6% [−13, −0] | −0.4 [−3.8, +3.0] | −0.2 | −5.5% → −8.6% | Disagreement isn't a model-failure signal the books leave unpriced. | none (consistently negative) |
| **E:** ARCHR 3+ pts from no-vig | 94% | 2,785 (80 games) | −6.2% [−12, −1] | −0.0 [−2.9, +2.7] | −0.1 | −4.9% → −8.4% | Same | none (consistently negative) |

**Sensitivity:** every fade's leave-one-day-out ROI stays negative (baseline −7% … −5%; A −17% … −7%; D −6% … −2%; E −9% … −5%). No single slate drives these results.

## Four strategies, tested separately

1. **Fading the predicted side at the same line:** tested for A, B, D and E at recorded prices. All lose.
2. **Taking an alternative line (C2):** for alt overconfidence, betting the main line's opposite side, at its own recorded price. −1.7% [−7, +4]: not profitable.
3. **Betting against an overpriced market:** the books' no-vig chance on these picks is well calibrated (Brier 0.2485 vs ARCHR 0.2493). No segment shows the books mispricing their own line enough to clear the vig (every "won − no-vig" interval spans zero).
4. **Exploiting a model calibration error:** the errors are real but aren't bets.
   - ARCHR's chance runs 9 pts high at plus money and 7–11 pts high on alt rungs.
   - The projection's spread is 22–44% too narrow beyond |z| 0.55.

   These are **model fixes** (see the plus-money report, Phase 7), not opportunities: the books already price these props correctly, so fixing ARCHR moves it toward the books, not past them.

## Answers

- **Should |z| above 0.75 be faded?** No: −12.1% at actual prices.
- **Can alternate-line overconfidence be exploited at actual opposite prices?**
  - At the same line it's untestable (8.5% coverage, selected).
  - As a main-line fade (a different bet) it loses (−1.7%).
- **Does any fade survive chronological validation?** No. Every hypothesis is negative or a small-sample read in at least one period, and none has an interval above zero in either.

## What would make fades testable or worth retesting

1. **Poll both sides of alt ladders** where books post them, so C becomes testable.
2. **Add more books' prices.** A fade only pays if a soft book hangs the opposite side above the consensus.
3. **Use the forward data.** Re-run this audit on picks frozen after Nov 17, which are untouched, and judge A–E only there, with these exact definitions.
