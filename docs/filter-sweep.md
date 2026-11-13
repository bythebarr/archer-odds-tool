# The most accurate screener filter set (−200 floor)

This is measurement only. Nothing in pricing, gating, scoring, capture or the screener changed.

**Source.** Model lab run #96, `sweep:filters`, production DB, branch `sam/filter-sweep` at `2ed4c63`, 2026-11-13.

## Method

1. **Where the picks come from.** The sweep uses every settled NBA prop lean from pick tracking: ARCHR's side at each book's main line, frozen before tip and settled after.
   - 4,057 leans over 7 slate days.
   - The earlier half runs through Nov 9.
   - Each lean is paid at **the price it had when captured**, flat stakes.
2. **Rebuilding the records.** Leans don't store the screener's L3, L5, L10, L15, this-season and last-season records. Those are rebuilt at the lean's line and side from the player's game logs before that game, counted the way the screener counts them (`screenRates`).
3. **The filter grid.** Each combination is a screener filter object, run through the screener's own `passes()`. It covers:
   - record bar: none, or one of 12 bars across the windows;
   - ARCHR ≥ 0 / 55 / 60 / 65 / 70%;
   - edge ≥ any / 0 / 3 / 5 / 8 pts;
   - side: both, overs or unders;
   - long end of the price range: any / +150 / +100;
   - NBA minutes ≥ 0 / 24 / 30.

   The **−200 floor is on in every combination**: 8,775 in all.
4. **How a set is judged.** "Held up" means positive ROI in both date halves, with 50+ picks in each. With 8,775 tries some look good by luck. A walk-forward pass therefore also picks the best sets on the earlier half alone and reads the later half.
5. **Cross-check.** The closing-price backtests use both sides of every line, prior games only. They cover only the slates whose prop quotes are still stored: **one NBA slate (700 sides, Oct 27) and one NFL slate (502 sides, Nov 1)**. That's too few to split by date. No combination there has two halves, so none can "hold up".

## Baseline: the floor alone

| Set | Picks | Hit | ROI |
|---|---|---|---|
| Every NBA lean priced −200 or longer | 4,008 | 49.9% | **−8.2%** |

## The most accurate set that held up

**L5 ≥ 80% · unders only · price −200 to +100 · projected minutes ≥ 24**

| | Picks | Hit | ROI [95%] | Per slate day |
|---|---|---|---|---|
| All | **319** | **60.8%** | **+8.7%** [−1%, +18%] | 45.6 |
| Earlier half | 187 | | +8.7% | |
| Later half | 132 | | +8.6% | |

- It has the highest hit rate of the 35 sets (of 8,775) that held up.
- The two halves agree almost exactly.
- The 95% interval still touches zero.
- Close variants: the same with no long cap (−200 to any) runs 326 picks, 60.1%, +7.6%. "Last szn ≥ 60%" instead of L5, with minutes ≥ 30, runs 281 picks, 60.1%, +7.7%.

### The broad base under it

**Unders only · price −200 to +100 · minutes ≥ 24**, with no record bar: **1,265 picks · 58.5% · ROI +5.9% [+1%, +11%] · early +6.0% (714) · late +5.9% (551)**.

This is the only set whose ROI interval clears zero. Adding the L5 ≥ 80% bar trades three-quarters of the volume for about +2.3 pts of hit rate and +2.8 pts of ROI.

### Volume against accuracy (all held up in both halves)

| Set (−200 floor on) | Picks | Hit | ROI | Early / late |
|---|---|---|---|---|
| unders · −200…+100 · min ≥ 24 | 1,265 | 58.5% | +5.9% | +6.0 / +5.9 |
| L5 ≥ 80% · unders · −200…any · min ≥ 24 | 326 | 60.1% | +7.6% | +8.0 / +7.0 |
| **L5 ≥ 80% · unders · −200…+100 · min ≥ 24** | **319** | **60.8%** | **+8.7%** | **+8.7 / +8.6** |
| last szn ≥ 60% · unders · −200…+100 · min ≥ 30 | 281 | 60.1% | +7.7% | +9.2 / +5.1 |
| edge ≥ 5 pts · −200…any · min ≥ 24 | 148 | 52.0% | +10.0% | +13.3 / +4.6 |

The top-ROI sets lean on a big edge, and they hit only about 52%. Higher payouts carry them. The most *accurate* sets are unders with a hot recent record.

### Walk-forward check

The 10 best sets on the earlier half kept a positive ROI on the later half only **5 times out of 10**. The earlier half's leaders were "edge ≥ 5 pts" with minutes ≥ 30 (+27.9% early). They turned **−12.9% later**.

The recommended set wasn't one of those early leaders. It was chosen with both halves in view, so it carries selection risk the walk-forward doesn't remove. Its own halves agree, which is the best evidence this sample can give.

## Read with care

- **Seven slate days.** Live tracking of priced NBA prop leans only covers about a week. One hot week for unders could produce this. Re-run `sweep:filters` as leans accumulate before relying on it.
- **Leans are ARCHR's side only.** The sample is ARCHR's side of each line, so "unders only" here means *unders ARCHR leans to*.
  - The screener shows both sides, and has no "ARCHR's side" filter.
  - The closest screener setting is an ARCHR floor near 50%. The lowest ARCHR chance among the leans is 46.3%, so even that isn't exact.
  - The grid's ARCHR floors start at 55%, so 50% wasn't swept.
- **NFL can't be measured live.** All 872 settled NFL prop leans have **no price**: they come from ESPN numbers, which carry no price. The NFL picture is the one Nov 1 slate in the backtest.
  - There, the highest-hit set with 100+ picks was "edge ≥ 0 pts · −200 to +100": 100 picks, 58.0%, +9.7%.
  - That's a single slate with no halves, so it's not a recommendation.

## By stat, inside the recommended set

The screener's stat tiles can switch any of these off.

| Stat | Picks | Hit | ROI |
|---|---|---|---|
| assists | 41 | 68.3% | +17.4% |
| points | 35 | 62.9% | +16.8% |
| pts + reb | 47 | 61.7% | +15.0% |
| pts + reb + ast | 38 | 60.5% | +14.5% |
| pts + ast | 36 | 61.1% | +14.4% |
| rebounds | 51 | 58.8% | +1.2% |
| reb + ast | 32 | 56.3% | −1.7% |
| threes | 39 | 56.4% | **−8.1%** |

Each row has 32–51 picks, which is too few to act on alone. Threes is the one stat losing inside the set.

## Filters the screener can't set yet

Each was tried on top of the recommended set (319 picks, 60.8%, +8.7%) where the data allows.

| Filter | Result | Read |
|---|---|---|
| **ARCHR's side only** (the lean side) | — (it *is* the sample) | The screener shows both sides, so the set above can't be reproduced exactly. This is the gap that matters most. |
| Projection distance \|z\| ≥ 0.75 | 11 picks · 36.4% · −37.5% | Nothing to add. It nearly empties the set and loses. |
| ARCHR within 8 pts of the books | 311 · 60.8% · +8.7% | No change: nearly every pick already qualifies. |
| ARCHR 3–15 pts above the books | 112 · 58.0% · +10.5% | Halves disagree (+2.3 / +22.7). Not established. |
| 20+ games of history | 302 · 59.9% · +7.3% | Slightly worse. The screener's "min games per window" is a different filter. |
| Role-weighted L10 ≥ 60% | untestable | Leans don't store the role-weighted record. |
| Confidence floor (grade B / score ≥ 60) | untestable | The screener can *sort* by Confidence but not filter. None of the 4,057 settled NBA leans carries the grade it was shown with, so the grade can't be checked against results yet. |
| NFL priced picks | untestable | No NFL lean has a price (above). |

## Recommendation

**L5 ≥ 80% · unders only · price −200 to +100 · projected minutes ≥ 24.**

- 60.8% hit rate and +8.7% ROI on 319 picks.
- Both halves +8.7% / +8.6%.
- About 46 picks per slate day among ARCHR's leans.

If volume matters more than accuracy, drop the L5 bar. That gives 1,265 picks at 58.5% and +5.9%, the only set whose interval clears zero.

Either way:
- treat it as one week of evidence;
- add an "ARCHR's side" filter so the screener can show exactly this set;
- re-run the sweep weekly as leans accumulate.

## Reproduce

Model lab → script `sweep:filters` (read-only). Code:
- `src/lib/audit/filterSweep.ts` (pure, tested);
- `scripts/sweep-filters.ts`;
- `scripts/props/leanScreenRows.ts`.
