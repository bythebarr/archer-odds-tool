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
| **Tennis (surface Elo)** | ✅ **trusted** | 20000 | **0.2187** | 0.2301 | **−0.0114** |
| UFC (fighter-math) | ✅ trusted | 1227 | 0.2403 | 0.2425 | −0.0022 |
| MLB (moneyline) | 🟡 marginal | 1343 | 0.2499 | 0.2489 | +0.0010 |

**Tennis is the strongest model by far** — ~5× UFC's skill and genuinely
discriminating (its 52%→87% probability buckets each match the real win rate to
within ~2pt after the 0.75 shrink). MLB and UFC sit within a hair of a coin flip —
as expected (see the docstrings in `winProbability.ts` and `fighterMath.ts`).
Calibration keeps them **honest**; it does not manufacture edge. The MLB
`backtest:mlb` reproduces the previously never-committed shrink-0.2 audit, so that
constant is now defensible from source.

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
