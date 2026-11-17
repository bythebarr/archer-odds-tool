# ARCHR Edge: one-sprint alpha development (NBA props)

**Status:** experimental. Production pricing, calibration, selection, grading and betting recommendations are unchanged. Nothing here is a proven edge, and no plus-money filter is validated.

**What this sprint built:**

- minutes model v2;
- a corrected projection pipeline;
- the v2 probability distribution;
- a market-value engine;
- a plus-money research screen (`/nba/research`);
- automatic pregame tracking of every experimental number, and a forward evaluator that compares them against the books.

It builds on the v1 shadow and its protocol (`docs/model-improvement-plan.md`, #135).

## 1. What was implemented

| Component | Where | What it does |
|---|---|---|
| Minutes model v2 | `src/lib/shadow/v2.ts` (`minutesV2`, `minutesV2Features`) | Production's minutes (before tonight's spread) plus a fitted correction. Inputs: high projections (over 32 and over 36), his season-to-date minutes against the recency read (the early-season carryover, shrunk by n/(n+5) for n games this season), last-3 gap, last-10 volatility, bench role, a role in flux, a first game back, cut-short games. Then the spread trim. |
| Minutes uncertainty | `v2.ts` `V2_PARAMS.dist` | The v1 miss-size model refitted around minutes v2, with empirical standardized misses (left-skewed). |
| Per-minute rate correction | `v2.ts` (`rateGap`, `V2_PARAMS.rate`) | Production's effective rate × exp(a + b × the shrunk log gap between his season-to-date rate and production's), per component. |
| Displacement | `v2.ts` (`V2_PARAMS.gamma`) | The departure from his last-20 average, scaled by a fitted γ per component. Fitted against outcomes, never against a book price: a projection correction, kept separate from any market shrinkage. |
| Combined-stat consistency | `v2.ts` (`v2Projection`) | PRA, P+R, P+A and R+A are the sum of their corrected components, so a combo can't disagree with its parts. |
| v2 distribution | `v2.ts` (`v2Distribution`) | s2's machinery around minutes v2 and the corrected mean: minutes mixture × per-minute dispersion, κ-widened. Valid probabilities; Over and Under are complementary, with whole-number pushes refunded. |
| Market-value engine | `src/lib/shadow/marketValue.ts` | See §4. |
| Research screen | `src/app/nba/research/page.tsx` | See §5. |
| Pregame tracking | `src/lib/shadow/capture.ts`, `src/lib/tracking/capture.ts` | v2 records under `shadow:nba-props-v2` (own key, own start). |
| Forward evaluation | `scripts/eval-shadow.ts`, `src/lib/shadow/forwardEval.ts` | Production, the projection correction alone (`corr`), s2, v2 and the books, scored on the same props. |
| Labs (read-only) | `lab:nba-v2`, `diagnose:research` | The fit and its holdout; tonight's board. |

Shared replay: `scripts/props/nbaReplay.ts`.

## 2. Historical evaluation (permissible data only)

**Model lab run #106.** The constants were fitted once on the **first 70% of 2025-26** by date (16,020 player-games, up to 2026-03-11). They were judged on the **untouched last 30%** (7,045 player-games, 343 games).

- 2026-27 before Nov 17 (4,092 player-games) was already read by run #103 and the audits. It's shown as a second look, never as evidence.
- Games from Nov 17 on are never read.
- Every projection is rebuilt **without** the replay's reconstructed absences, because who actually sat is postgame knowledge.

The line is a stand-in (his last-10 average rounded to the half point): no 2025-26 prop prices are stored.

**Holdout (clean).** Line log loss is at the stand-in line; lower is better. s2 is marked † because its constants were fitted on all of 2025-26, so it's in-sample here and shown only for reference.

| Stat | Line log loss: prod / s2† / corr / v2 | Log score: prod / v2 | 80% coverage: prod / v2 | Mean abs error: prod / v2 |
|---|---|---|---|---|
| PTS | 0.6723 / 0.6719 / 0.6756 / 0.6743 | −3.092 / **−3.049** | 0.790 / 0.849 | 4.677 / 4.703 |
| REB | 0.6602 / 0.6594 / **0.6585** / 0.6590 | −2.202 / **−2.188** | 0.868 / 0.890 | 1.873 / 1.872 |
| AST | 0.6505 / 0.6496 / 0.6545 / 0.6544 | −1.931 / **−1.929** | 0.893 / 0.899 | 1.360 / 1.370 |
| 3PM | 0.6403 / 0.6402 / **0.6389** / 0.6391 | −1.663 / **−1.658** | 0.921 / 0.932 | 0.940 / 0.939 |
| PRA | 0.6759 / 0.6725 / 0.6770 / 0.6755 | −3.426 / **−3.385** | 0.778 / 0.829 | 6.167 / 6.203 |
| P+R | 0.6738 / 0.6710 / 0.6756 / 0.6742 | −3.322 / **−3.280** | 0.784 / 0.839 | 5.637 / 5.659 |
| P+A | 0.6744 / 0.6720 / 0.6773 / 0.6752 | −3.218 / **−3.177** | 0.783 / 0.836 | 5.191 / 5.223 |
| R+A | 0.6621 / 0.6607 / 0.6627 / 0.6634 | −2.536 / **−2.522** | 0.841 / 0.865 | 2.595 / 2.607 |

**Minutes (holdout):**

| | Production | Minutes v2 |
|---|---|---|
| Mean absolute miss | **5.12** | 5.19 |
| Projected 35+: bias | −0.91 | **+1.35** (over-corrected) |
| Bench: bias | +0.03 | −0.36 |
| Coverage of the 80% minutes band | — | 0.788 |

**What this says, honestly:**

- **The distribution improvement is real out of sample.** v2's log score beats production on all 8 stats (the widened minutes-mixture distribution; κ refitted on training only). Coverage moves from about 0.78 toward 0.83–0.85 (nominal 0.80). Slight over-coverage remains.
- **The projection corrections did not carry over to the late-season holdout.**
  - The corrected projection alone (`corr`) is worse than production on line log loss for 6 of 8 stats.
  - Mean absolute error rises a little.
  - Bench, returning, volatile and under-22-minute players get worse.
  - Minutes v2 over-corrects high projections.
- **On the early-season 2026-27 sample (already seen, not evidence),** the same corrections improve every stat:
  - minutes: PRA bias −0.77 → −0.68, 35+ bias −3.5 → −2.1, mean absolute miss 5.11 → 5.03;
  - line log loss: `corr` beats production on all 8 stats (PRA 0.6591 → 0.6531).
  
  That points to a season-phase effect: the season-to-date reads matter early and mislead late. A fit on one phase doesn't transfer.
- **The minutes mixture beats a single minutes node** on training (log score summed over stats −20.79 vs −20.92), so minutes uncertainty does widen the distribution usefully.
- **Far calls:**
  - Without reconstructed absences, production's far calls are only mildly overconfident (PRA, 0.75–1 SD from the line: said 82%, won 74%). v2 now runs *under*confident there (71%).
  - With reconstructed absences (run #103), production's far calls were far more overconfident (81% said, 67% won).
  - **Hypothesis:** the teammate-absence adjustments generate much of the extreme displacement that regresses toward the line. This can't be tested cleanly historically, because absences are only reconstructable postgame. It's measurable forward, since the live capture records each prop's injury context.

Constants are frozen exactly as fitted (`V2_PARAMS`, run #106). Nothing was refitted after seeing the holdout.

## 3. Probability distributions

v2 = s2's widened variance (κ refitted) around minutes v2 and the corrected mean, with minutes uncertainty as an equal-weight 10-node mixture. Over and under are coherent by construction: P(under) = 1 − P(over) − P(push), and main lines are half points. No book price enters any model probability. The market appears only in the no-vig baseline and the EV arithmetic.

## 4. Market-value engine (`marketValue.ts`)

For every main-line prop side:

- player and market;
- offered line, odds and book;
- ARCHR raw chance (production's projection alone);
- the experimental chances (v2 and s2);
- the books' no-vig chance, with the offered book **left out** wherever another book hangs both sides; otherwise it's that book's own pair, labeled single-book;
- break-even;
- **estimated EV at the offered price** (the lower of s2's and v2's), each model's own EV, and the market EV (what the no-vig read says the price is worth);
- projection distance (v2, toward the side);
- minutes reliability (predicted miss: stable under 4.5 min, unstable 6+);
- injury tag and lineup status (confirmed starter, confirmed bench, or unconfirmed);
- price age (the quote's own read time; an unknown time counts as stale);
- the evidence status and why.

No odds or market data are invented. A side without a two-sided market has no no-vig read, and says so.

**Data dependency:** today the NBA prop feed is almost entirely DraftKings (via ESPN), so most no-vig reads are single-book and market-dependent. The engine computes the leave-one-out consensus automatically wherever a second book appears.

## 5. Plus-money research screen (`/nba/research`)

- **Default range** +100 to +175, switchable to +100 to +300 or all prices.
- **Ranking:** sides that pass the data-quality gate are ranked by estimated EV. The others follow by research priority (fewest warnings, then how far the models sit from the market), which is not a profitability ranking.
- **The gate fails on:** unstable minutes, an injury tag, extreme distance (over 1 SD), a stale price (over 150 min, or an unknown time), thin history (under 15 games), or no two-sided market.
- **Shown but not gating:** plus-money calibration (ARCHR has run high at plus money), single-book, and an unconfirmed lineup.
- L5/L10/L15 hit rates are not used as a positive signal anywhere. Model disagreement is never auto-faded. Zero candidates is a valid answer.

**Evidence status:**

- **Research candidate:** every row.
- **Forward-testing candidate:** passes the frozen rule `plus-money-v1`, pre-registered 2026-11-17:
  - the side is priced +100 to +175;
  - it passes the quality gate;
  - its EV is at least +3% at that price under **both** s2 and v2 (the lower counts);
  - one per player, at most six per slate (ET day; capture batches share the six);
  - it's ranked by that conservative EV.
  
  Both models must clear the bar because v2's corrections failed the clean holdout (§2), so neither model alone sets the EV.
- **Independently validated positive-EV candidate:** only if `plus-money-v1` is added to `VALIDATED_RULES` under the promotion checklist (§8). It's empty, and nothing on the screen can display that status today.

The screen applies the rule live at view time. The candidates that count are those the capture froze before tip (recorded in `shadow:nba-props-v2`, `candidate` field).

## 6. Automatic forward evaluation

Every model version has its own key and its own start (the first game it froze before tip, from Nov 17 ET):

| Version | Model key | Forecasters recorded |
|---|---|---|
| v1 (#135) | `shadow:nba-props` | books' no-vig, production raw / model / blend / shown, s1, s2 |
| v2 (this PR) | `shadow:nba-props-v2` | the same, plus `corr` (projection correction alone) and `v2` (combined); each side's price, no-vig, EV, warnings, quality and the rule's verdict |

`npm run eval:shadow` (Model lab) scores each version on its own records.

- **Primary:** game-clustered log loss vs the books' no-vig chance (v1: s2; v2: v2), read as a decision only after **250 settled games**.
- **Secondary:**
  - Brier, calibration bins and ECE for every forecaster;
  - v2 vs production raw, shown and s2;
  - independence beyond the books (offset logistic, and a first-half → second-half test);
  - a fixed EV rule's realized ROI and CLV, at all prices and at +100 to +175 only;
  - the **frozen candidate rule's** picks: ROI, CLV, and picks per slate (days with zero, days with six);
  - plus-money subgroup (props with a side priced +100 to +175), single vs combined stats, |z| ≥ 0.55;
  - within-game residual correlation.
- **Integrity:** captures at or after tip and duplicates must both be 0.

The rule and every model constant are frozen. Confirmation needs games that were not yet played when the rule was frozen.

## 7. Answers (as of 2026-11-17)

1. **Implemented:** everything in §1 is built, tested and recorded before tip. Production is unchanged.
2. **Historical accuracy (clean holdout):**
   - the v2 distribution improves log score on all 8 stats (PTS −3.092 → −3.049; PRA −3.426 → −3.385) and moves coverage toward nominal;
   - the projection corrections do not improve the late-season holdout (worse line log loss on 6 of 8 stats);
   - minutes v2 does not improve holdout minutes (mean absolute miss 5.12 → 5.19).
   
   On the early-season sample (seen, not evidence), all of them help.
3. **Needs fresh forward testing:**
   - whether the corrections help in the early-season regime they were meant for;
   - whether any experimental chance beats the books' no-vig chance;
   - the plus-money subgroup;
   - the candidate rule's ROI and CLV.
4. **Beats sportsbook probabilities on untouched games?** Unknown. No experimental record has settled yet: v1 records from tonight, v2 from its deploy. It's read at 250 settled games.
5. **Any plus-money filter independently validated?** No.
6. **Can the screen identify candidates today?** Yes, mechanically. Tonight the frozen rule finds 6 forward-testing candidates (see "Tonight"). Their estimated EVs (+13% to +19%) rest entirely on ARCHR against a single book, at the size of ARCHR's known plus-money bias, so they are unvalidated hypotheses.
7. **Highest-value remaining blocker:** **independent market prices.** Nearly every NBA prop quote comes from one book (DraftKings via ESPN). So:
   - the no-vig "baseline" is that book's own pair;
   - the leave-one-out consensus can't be formed;
   - expected value can't be checked against an independent price.
   
   Without a second sharp source, a model that "beats DraftKings' no-vig" can't be told apart from one that finds DraftKings' noise, and a +EV estimate rests entirely on ARCHR. Adding a second independent prop feed (several books, ideally one sharp) unblocks the consensus, the leave-one-out EV and closing-line value against a real market.

## 8. Promotion checklist

A rule or model change moves from forward-testing toward production only when **all** of these hold, on games played after it was frozen:

- [ ] ≥ 250 settled games for that version (game-clustered).
- [ ] **Primary:** log loss vs the books' no-vig chance, with the 95% interval entirely above zero.
- [ ] **Independence:** the offset-logistic weight's interval excludes 0, and the first-half → second-half test helps on the later half.
- [ ] Calibration: ECE no worse than the books', and plus-money bins within the interval of what happened.
- [ ] No stat and no listed subgroup (bench, returning, volatile, 35+) worse than production by more than its interval.
- [ ] **For a betting rule:** realized ROI interval above zero **and** positive closing-line value, on the rule's own frozen picks, after the vig.
- [ ] A second confirmation window of untouched games (the first window can't both discover and confirm).
- [ ] An independent market source for the no-vig baseline, or the result is explicitly labeled single-book.
- [ ] Integrity: 0 captures at or after tip, 0 duplicates.
- [ ] A separate, explicitly approved PR. Only then may a rule id enter `VALIDATED_RULES`, or a constant reach production.

Better calibration alone never qualifies as a betting edge.

## Tonight (2026-11-17, read-only production checks)

`diagnose:leans` (Model lab #108, a dry run that writes nothing) froze 450 v2 records across the next 17 games, beside v1's 450 and production's 542 leans.

`diagnose:research` read tonight's board twice, both before tip and before any result existed.

**Run #107, before the disagreement gate:**
- 450 props, every quote from **DraftKings** (4,203 quotes, one book).
- 153 sides at +100 to +175; 137 passed the quality gate, and 52 showed positive EV.
- The rule picked 6, all unders, with estimated EV of **+29% to +77%**.
- Example: Josh Okogie under 5.5 points at +102. ARCHR raw said 93%, v2 85%, the book's no-vig 47%.

Gaps that size are almost certainly model failures, not value. So the `implausible-disagreement` gate (either model more than 12 points from the no-vig chance means research only) was added then, after seeing tonight's unsettled candidate list and before any outcome.

**Run #109, after the gate:**
- 47 plus-money sides flagged implausible; 92 pass the gate, and 26 show positive EV.
- The rule finds **6 forward-testing candidates**, EV +13% to +19%: Keyonte George U1.5 3PM +144, Brandon Miller U2.5 AST +120, Kevin Huerter U2.5 AST +122, Sion James O3.5 AST +134, Coby White U5.5 R+A +114, Jalen Brunson O2.5 3PM +122.
- Each sits 7–11 points above DraftKings' no-vig chance, about the size of ARCHR's documented plus-money overconfidence (about 9 points).
- Read them as hypotheses to be judged forward, not edges. Their market EV against DraftKings' own no-vig is about −6% each, which is the vig.

## Reproduce

| What | Command | Notes |
|---|---|---|
| Fit and holdout | `npm run lab:nba-v2` | Model lab; read-only |
| Forward evaluation | `npm run eval:shadow` | Both versions |
| Tonight's research board | `npm run diagnose:research` | Read-only |
| Tonight's capture | `npm run diagnose:leans` | Dry run, nothing written |
| Tests | `npx vitest run src/lib/shadow` | |
