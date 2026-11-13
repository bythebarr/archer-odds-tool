# Soft-book price lag vs Pinnacle

This backtest is diagnostic only. No pricing, gating, UI or capture changed.

- **Source:** Model lab run #86, `backtest:soft-book-lag`, production DB, branch `sam/one-number` at `86a143f`, 2026-11-13.
- **Data:** stored `OddsSnapshot` history, main lines only, polls before each game, games with a final score.
- **Window:** 2026-07-21 22:07 UTC → 2026-11-13 02:45 UTC.

## Verdict

**Not distinguishable from zero.** Betting the stale soft price returned +10.8% on 151 bets. The 95% interval is −4.3% to +25.8%, which includes zero.

Closing-line value points the other way: on the 46 bets with a close at the same number, the bet price was 2.0 pts of implied chance worse than the close. That is weak evidence the edge is real.

## Method

- **Sharp baseline.** Pinnacle; all 10,552 of its rows carry their own update time.
  - Soft books: DraftKings, FanDuel, BetMGM, Caesars, ESPN BET, Fanatics, BetRivers, Hard Rock, bet365 (144,080 rows).
  - Pinnacle and the soft books are never captured in the same poll. Run #85 showed this and returned DATA REQUIRED on a same-poll design.
  - So each soft quote is judged against Pinnacle's latest two-sided quote at or before it, at most 6 h old. An older quote no longer says where the sharp market is.
  - 47,912 soft quotes had such a Pinnacle quote.
- **Move.** Pinnacle moves toward a side when its no-vig chance rises at least 1.2 pts at the same number, or when the number moves against the side. 1.2 pts is about 5 cents at −110 (−110 → −115).
- **Lag window.** At least 10 minutes. Retail books usually follow within minutes, so a quote still older than the move after 10 minutes is stale, not feed jitter.
- **Stale.** A soft quote is stale when either:
  - its own update time is before Pinnacle's move; or
  - for the 54% of soft rows with no update time of their own (77,700 of 144,080), the same price and number were already on the board before the move, unchanged since.
  
  The quote must still beat Pinnacle's new terms: positive EV at the same number, or a better number.
- **Bet.** One bet per game × market × side × book, at the first poll where it fires, 1 unit at the stale price.
- **Settlement.** From the final score at the bet's own number.
  - `GameOutcome` only grades the consensus closing number, so it serves as a cross-check: 53 of 53 bets agree where both grade the same bet.
  - CLV is measured against `GameClosingLine` at the same number.
- **Exclusions.** Soccer moneylines are left out because they are three-way.

## Results

Buckets under 50 bets are thin: they are listed, but they are not verdicts.

| Bucket | n | Hit | ROI [95%] | CLV (n) |
| --- | --- | --- | --- | --- |
| **All lag bets** | 151 | 58.0% | +10.8% [−4.3, +25.8] | −2.02 pts (46) |
| *Lag size* | | | | |
| Number: 0.5 pt better | 110 | 55.5% | +6.0% [−11.8, +23.8] | −2.23 (40) |
| Number: 1+ pt better | 28 (thin) | 85.7% | +62.3% [+37.3, +87.3] | −0.11 (4) |
| Price: EV 0–2% | 9 (thin) | 25.0% | −41.7% | −1.47 (2) |
| Price: EV 2–5% | 4 (thin) | 0.0% | −100% | — |
| *Minutes since Pinnacle moved* | | | | |
| 10–29 min | 143 | 59.2% | +13.0% [−2.4, +28.4] | −2.04 (45) |
| 30–119 min | 8 (thin) | 37.5% | −29.1% | −0.88 (1) |
| *How staleness was established* | | | | |
| Own update time | 148 | 57.8% | +10.5% [−4.7, +25.7] | −2.02 (46) |
| Unchanged since before the move | 3 (thin) | 66.7% | +23.9% | — |
| *Book* (all thin) | | | | |
| BetMGM | 26 | 65.4% | +25.8% [−10.1, +61.8] | −4.60 (7) |
| DraftKings | 26 | 50.0% | −5.4% [−42.5, +31.6] | −0.04 (8) |
| Caesars | 25 | 58.3% | +10.5% [−26.3, +47.3] | −4.95 (7) |
| bet365 | 24 | 54.2% | +2.6% [−35.9, +41.2] | +0.09 (8) |
| Fanatics | 21 | 52.4% | +0.4% [−41.5, +42.4] | +0.03 (7) |
| Hard Rock | 17 | 64.7% | +25.8% [−19.8, +71.5] | −5.40 (5) |
| BetRivers | 12 | 66.7% | +26.9% [−26.1, +80.0] | +0.12 (4) |
| *Market* | | | | |
| Totals | 119 | 56.3% | +7.4% [−9.6, +24.5] | −2.30 (40) |
| Spreads | 22 (thin) | 90.5% | +69.7% [+45.2, +94.2] | −0.11 (6) |
| Moneyline | 10 (thin) | 10.0% | −79.0% | — |
| *Sport* | | | | |
| NFL | 133 | 61.4% | +16.6% [+0.8, +32.3] | −0.05 (42) |
| MLB | 18 (thin) | 33.3% | −31.9% | −22.64 (4) |

## What it means, and what limits it

- **Too few bets.** 151 bets fired across 116 days. The polls are sparse (a few a day), and Pinnacle has about 7% as many rows as the soft books. A lag that lasts minutes is rarely caught.
- **NFL is the only bucket with a positive interval:** +16.6% [+0.8, +32.3] on 133 bets. But it is one bucket among many, and CLV is flat there (−0.05 pts), so treat it as a lead, not a finding.
- **Mostly NFL totals at half a point.** 110 of the 151 bets are "0.5 pt better" number lags, mostly NFL totals.
- **No NBA or NHL bets fired.** On the stored snapshots, no NBA or NHL soft quote met the conditions.
- **Sharpening the test needs data the feed doesn't keep:** Pinnacle and the soft books polled together, at least every few minutes. With today's history, a verdict needs several times more bets.
