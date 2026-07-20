# Model calibration harness (sport-engine Phase 4a)

> A model's `modelEv` is only as trustworthy as its probabilities. If it says
> "60%" but that bucket wins 52%, every EV computed off it is inflated. This
> harness measures that gap the **same way for every sport**, so no model prices
> the paid card until it has earned the right — and every future sport's model
> plugs into the same bar by default.

## The pieces

| Layer | File | What it is |
|---|---|---|
| Pure metrics | `src/lib/engine/calibration.ts` | Brier, log-loss, reliability buckets, base-rate benchmark, time-split shrink refit, `scoreCalibration` → verdict, `formatCalibrationReport`. No I/O; unit-tested in `calibration.test.ts`. |
| Contract hook | `src/lib/engine/types.ts` → `SportModel.backtest?: ModelBacktest` | A model's optional ability to yield lookahead-safe `{pred, won}` samples. The only sport-specific part of calibration. |
| Per-sport sampler | each adapter's `model.backtest.collect` | Rebuilds each historical event's prediction **as of** that event (no future-data leak) and records the model favorite's prob vs. the actual result. |
| CLIs | `npm run backtest:mlb` / `backtest:ufc` / `backtest:all` | Score the samples and print a report card + trust summary. |
| Trust snapshot | `SportModel.calibration?: CalibrationSnapshot` | The last backtest's verdict baked onto the model, so the board/Discord can read trust without re-running a backtest live. **Refresh it when you re-run the backtest.** |

## The verdict (the trust gate)

`skill = brier − baseRateBrier` (negative = beats a no-skill guess). Deliberately
three-way, because near-coin-flip sports shouldn't fall on opposite sides of a
razor-thin line:

- **✅ trusted** — `skill ≤ −0.002`: a real (if thin) demonstrated edge.
- **🟡 marginal** — within ±0.002 of no-skill: calibrated enough to *show*, not to
  lean paid stakes on. The honest middle.
- **❌ unproven** — `skill ≥ +0.002`: overconfident / miscalibrated. Must not price.
- **⚪ thin** — under the sample floor (100) to judge yet.

"unproven" ≠ "miscalibrated per se" — a model can be perfectly calibrated yet
edgeless; both fail the "trust it to find EV" bar, which is what the gate asks.

## No lookahead leakage

The one rule that makes a backtest honest: rebuild each prediction using **only
data that existed before the event**.

- **UFC** — `getUfcMatchupAsOf(a, b, eventDate)` restricts fight history to bouts
  before the target.
- **MLB** — team form via `getTeamFormForGame(..., before)`, and starter ERA
  computed straight from that pitcher's earlier `PlayerGameLog` lines (NOT the
  stored season aggregates, which are full-season totals and would leak the rest
  of the year's results).

## Latest run — 2026-07-16

| Sport | Verdict | n | Brier | base-rate | skill |
|---|---|---|---|---|---|
| **Soccer (Poisson goals)** | ✅ **trusted** | 12000 | **0.2368** | 0.2498 | **−0.0130** |
| **Tennis (surface Elo)** | ✅ **trusted** | 20000 | **0.2187** | 0.2301 | **−0.0114** |
| **NFL (team Elo)** | ✅ **trusted** | 6000 | **0.2199** | 0.2292 | **−0.0093** |
| UFC (fighter-math) | ✅ trusted | 1227 | 0.2403 | 0.2425 | −0.0022 |
| MLB (moneyline) | 🟡 marginal | 1343 | 0.2499 | 0.2489 | +0.0010 |

**Tennis and NFL are the strongest models** — both genuinely discriminating and
well-calibrated (each 50–85% probability bucket matches the real win rate to within
~2pt; tennis after its 0.75 shrink, NFL as-is with a 0.95 refit best-shrink, i.e. only
a hair overconfident). MLB and UFC sit within a hair of a coin flip — as expected (see
the docstrings in `winProbability.ts` and `fighterMath.ts`). Calibration keeps them all
**honest**; it does not manufacture edge — and a trusted calibration verdict is NOT a
market-beating one (see the CLV finding below: NFL is calibration-trusted yet
CLV-negative). The MLB `backtest:mlb` reproduces the previously never-committed
shrink-0.2 audit, so that constant is now defensible from source.

The NFL model is the model LAYER only for now (`src/lib/nfl/{games,elo,model}.ts`,
`npm run backtest:nfl`) — free nflverse data, validated but not yet wired to a live
odds pipeline/nav. That live SportAdapter lands once the paid odds-feed decision is
made; validating the model first is the deliberate "no surprises on the data" play.

## Calibration ≠ edge — the CLV finding (2026-07-16)

The trust gate measures whether a model's probabilities are HONEST (does its 60%
win 60%). It does **not** measure whether the model BEATS THE MARKET. Those are
different, and conflating them would be the biggest way to mislead ourselves.

`npm run backtest:tennis:clv` is the honesty check: walk-forward over free
tennis-data.co.uk history (results + surface + closing odds), bet the model's +EV
picks INTO the closing line, measure realized ROI. Findings:

| Window | vs Pinnacle (sharp) | vs Best line (shopped) | vs Avg book |
|---|---|---|---|
| 2010–2024 | −4.24% | −0.10% | −9.40% |
| 2019–2024 | −2.87% | −1.11% | −8.46% |

**The surface-aware Elo does NOT beat modern closing lines.** A profitable-looking
5–10% EV pocket in the full sample (+2.46% at best line) evaporates in recent years
(−0.98%) — it was old, softer markets, not a persistent edge. The buckets are noisy
and non-monotonic recently: no reliable relationship between model-EV size and
realized ROI.

**What this means for the product (applies to every main-line model, not just tennis):**
a pure public-info model — Elo, Archer, fighter-math — is well-calibrated but the
market has already priced its information in. The member value is the **honest
analysis + line-shopping**, NOT "guaranteed +EV vs the close." Real betting edge, if
anywhere, lives in **less-efficient markets (props) and catching stale prices**, not
main-line moneylines. This is why tennis (and UFC) stay **signal-only**, never
auto-posted as +EV picks — calibration-trusted, but not market-validated.

### Soccer (3-way, in-season) — first draw-native model, CLV-tested on free data

Soccer is the first THREE-way sport (home/DRAW/away), so it uses a Poisson goals model
(`src/lib/soccer/{footballData,poisson,model}.ts`) instead of a 2-way Elo: online
attack/defense strengths → expected goals → a Poisson score matrix → 3-way probs. Trained
+ tested entirely on free football-data.co.uk (goals + closing 1X2 odds incl. Pinnacle,
21k matches, big-five leagues + Championship). Independent Poisson under-produces draws, so
the raw model was overconfident (80% picks won ~75%, refit wanted a 0.70 shrink); a
`drawBoost` low-score correction (0.5, tuned on the reliability curve) fixed it — overall
gap −2.8pt → −0.1pt, skill −0.0092 → **−0.0130 (our best)**, refit best-shrink back to 1.00.

CLV (`npm run backtest:soccer:clv`) — same verdict as everyone else:

| Ref | sample | ROI |
|---|---|---|
| Pinnacle (sharp) | 7,708 | −3.85% |
| Best (shopped) | 3,934 | −2.63% |
| Average | 6,036 | −3.87% |

The model's +EV picks skew to **draws/underdogs** (where it most disagrees with the market)
and those lose (draws −2.70%, away dogs −10.19%); EV buckets are non-monotone. **Notable
line-shopping signal:** backing the market FAVORITE at the best-shopped (MaxC) closing price
went **+1.48%** over 13,809 bets — i.e. the edge is line-shopping, NOT the model's
disagreements. Same story, fifth model. Soccer stays signal-only.

### NFL (biggest sport) — CLV-tested BEFORE building the adapter

`npm run backtest:nfl:clv` runs the same beat-the-close test on free nflverse
`games.csv` (7,276 games 1999–2025: results + closing spread/total, moneylines 2019+),
walk-forward `NflElo`. Deliberately spiked *before* building the NFL adapter — test the
riskiest assumption first, on free data, so no surprises when the paid-data decision comes.

| Market | window | sample | ROI |
|---|---|---|---|
| ATS (model vs close, ≥1pt, −110) | 2007–2025 | 3,798 | **−3.38%** |
| ATS | 2019+ (recent) | 1,462 | **−6.80%** |
| Moneyline (model +EV into close) | 2019+ | 879 | **−7.97%** |

Same verdict as tennis, on the biggest, sharpest market: a **calibration-trusted** NFL
model does **not** beat the close. One wrinkle — ATS ROI is monotone by model-vs-market
disagreement (1–2pt −7.3% → 5pt+ **+2.43%**, but only 539 bets); not a green light, since
a public-info Elo disagreeing with the close by 5+ points usually means the market has
info (injury/weather/QB) the model lacks, so likely noise. NFL, when surfaced, leads with
line-shopping + PROPS (deepest prop market), model signal-only.

### Tennis Elo (Phase 4b) — built on free data

The tennis model needs no paid feed: it's trained + backtested entirely on the
free public Jeff Sackmann ATP/WTA archive (`npm run import:tennis` →
`TennisArchiveMatch`, 62k matches 2015–2026). Elo (`src/lib/tennis/elo.ts`) is a
surface-aware, K-decaying rating; the backtest replays the archive chronologically
and scores each match's pre-match favorite probability — lookahead-safe by
construction (the pre-match rating can't see the result). The raw model was ~4pt
overconfident; a baked 0.75 logit-shrink (validated out-of-sample) fixes it. Data
caveat: the mirror's newest match is ~7 weeks stale, so current ratings slightly
lag the very latest results — fine for slow-moving Elo, refreshed by re-import.

## Adding a new sport's model to the harness

1. Give the model a `backtest: { unit, collect }` that returns lookahead-safe
   samples newest-first.
2. `npm run backtest:<sport>` (or it shows up in `backtest:all` automatically).
3. Bake the resulting `calibration` snapshot onto the model.

That's it — the metrics, buckets, refit, verdict, and trust summary are shared.
