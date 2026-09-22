# MLB prop projections & the matchup layer

> A player's trailing hit-rate is the *worst* predictor of his next game — a
> lookahead-safe backtest over ~23k player-games proved it. The projection layer
> turns raw rates into a calibrated next-game probability, then folds in the free
> matchup context a player-only rate can't see. This doc is the map of what's
> wired, what was investigated and **shelved**, and the bar that decides which.

## The base projection

`src/lib/props/projection.ts` → `projectPropHit(input, options)`. Empirical-Bayes:
treat the population base rate as a prior worth `PRIOR_STRENGTH_GAMES` (~30) games,
add the player's season record, read the posterior mean, then a tiny recency tilt
(`RECENCY_TILT` ~0.05) toward the L10. Fit on the older 70% of games, validated on
the newer 30% — beats raw-L10 and season-rate on out-of-sample Brier. Clamped to
[0.02, 0.98]. Pure and DB-free; the board (`mlbBoard.ts`) supplies the population
`baseRate`.

Two optional correction hooks, both summed in before the clamp:

- **`ramp: {slope, pivot, cap}`** — pitching only. Every pitching counting stat
  rides a within-season workload ramp (short April outings → 6-inning summer
  starts) that a season-pooled base rate understates. A bounded linear term in
  `seasonSample` (prior starts) de-biases it; the `cap` matters because workload
  saturates (best cap = 8) — unbounded overshoots. Fit via `npm run fit:pitcherramps`.
- **`contextShift: number`** — a caller-supplied additive probability shift for
  external matchup context. The generic seam every matchup term rides.

## The wired matchup terms

Each is a pure, tested `src/lib/props/*.ts` module that turns a trailing,
league-relative rate into a `contextShift`. All trailing-only ⇒ lookahead-safe.

| Term | Module | Prop | Shift | Fitted β (per line) |
|---|---|---|---|---|
| Opponent lineup K-rate | `opponentKRate.ts` | Pitcher Ks | `β·(oppKrate − league)` | o4.5 1.86 / o5.5 1.58 / o6.5 1.34 |
| **Ballpark K-rate** | `parkKRate.ts` | Pitcher Ks | `β·(parkKrate − league)` | o4.5 2.43 / o5.5 2.15 / o6.5 1.69 |
| Opposing starter K-rate | `opposingStarter.ts` | Batter Ks | `β·(starterKrate − league)` | 0.86 |

The pitcher-K number therefore carries **ramp + opponent + park**, summed into one
`contextShift` in `mlbBoard.buildPitcherBoard`. Board-side rates load as light
aggregate queries (opponent: one `groupBy`; park: ≤15 per-park aggregates keyed by
`game.homeTeamId`, no row load). Batter Ks carry the opposing-starter shift.

## The investigate → validate → wire bar

Every term above earned its place the same way; every shelved one failed it. The
harness is a `scripts/matchup-*.ts` study (one `npm run matchup:*` each):

1. Walk each player's games chronologically, projecting **lookahead-safe** (prior
   games only). For an *incremental* term, the baseline already includes the terms
   already wired (park was tested on top of the opponent shift).
2. Regress the **residual** (`actual − projection`) on the candidate signal — this
   nets out the player's own skill, so a signal that's just a proxy for skill
   won't move it.
3. Fit β on the older 70%, validate **out-of-sample** on the newer 30%: does Brier
   fall and f=1 ROI stay above the −5.7% edgeless floor?
4. **PA-confound check** — per-game o0.5-style props conflate skill with
   *opportunity* (plate appearances). If the residual spread is really just more PA
   the book already prices, it's an artifact, not signal. Report the PA gap.

Wire only if the OOS Brier improvement is meaningful **and** the PA gap is small
relative to the residual spread.

## Shelved — honest findings (not wired)

| Investigation | Script | Why shelved |
|---|---|---|
| Platoon (batter hand vs starter hand) | `matchup:platoon` | PA confound: platoon-edge games carry +0.44 PA (managerial pinch-hitting) → every counting stat rises together. Opportunity artifact, not hitting skill. |
| Batter park factors (hits/TB/HR) | `matchup:batterpark` | Real + PA-clean, but OOS Brier only −0.0005/−0.0006 (HR flat) — an order of magnitude below the pitcher-K terms. Offensive park factors are also the best-priced adjustment books make. |
| Opposing-team SB-allowed (SB o0.5) | `matchup:sb` | Real + PA-clean, but OOS Brier just −0.0001. Team-level proxy too coarse — steals hinge on the specific catcher's arm, which we don't log per game. |
| Batter hits vs opposing starter | `matchup:batter` | No OOS gain (DIPS: pitchers barely control BABIP). Only the batter-K half of that study wired. |
| Pitcher days of rest | `matchup:rest` | Standard rest (5 vs 6 days, ~87% of starts) is flat over ramp+opponent+park. Extended rest (≥7 days, n=293) shows a consistent +3–4.6pt and *does* improve OOS Brier (−0.0010, same order as wired terms) — a genuine lead. **But not wireable yet:** the obvious confound (extended rest clustering around the All-Star break / deliberate ace-skips) is **untestable on current data** — the archive is a single partial season (2026, Mar 26–Jul 7) that ends before the break. Revisit once multi-season / post-break data lands. |
| Opposing bullpen quality (HR/TB/Hits) | `matchup:bullpenprops` | Run against real production data (2026-09-22, ~49k batter-games). Real, correctly-directioned, PA-clean signal (Δ0.01–0.06 PA/g, nothing like platoon's 0.44) — but OOS Brier gain is only −0.0001 to −0.0002, *smaller* than even the already-marginal park-factor signal. Same underlying quality signal was also tried, unscaled, in the game-line totals/spreads backtest (see `MLB-MODEL-INVENTORY.md` §8) — real there too, same marginal tier. |
| Opposing bullpen recent-workload fatigue (HR/TB/Hits) | `matchup:bullpenprops` | Run same session as above. No OOS Brier gain on any of the three stats; the all-data beta flips sign on TB/HR (noise, not signal). Confirms the same finding independently reached by disabling this term in the game-line totals backtest — this specific signal doesn't hold up on real data. |

**Meta-finding:** batting-side matchup context is consistently marginal (OOS Brier
−0.0001 to −0.0006) versus the pitcher-K terms (−0.0013 to −0.0036). **Pitcher
strikeouts are the prop edge.** Remaining unexplored matchup factors need data we
don't have — day-of (weather, umpire) or finer-grained (catcher-level) — so the
free-data matchup space is now well-explored.

## Queued — built, not yet run

One new candidate, written the same session the game-line model gained park
weather — never tested against props. Complete and typechecks; hasn't been run
because it needs the `Venue`/`Game.venueId` schema, which didn't exist in
production at the time this doc was last updated (rides the same
`syncMlbSchedule` deploy that resolved `matchup:bullpenprops` above). Run once
that schema is live; wire only if it clears the same bar as everything above.

| Investigation | Script | What it tests |
|---|---|---|
| Park weather (temperature + direction-aware wind) | `matchup:weatherprops` | Does `weatherRunsShift` (`archer/weatherEffect.ts`, reused unchanged) predict batter HR/TB residuals? Needs real historical weather from Open-Meteo's archive API (free, confirmed live) — unlike the game-line platoon signal, this one genuinely CAN be backtested, since Open-Meteo has real historical data where the MLB Stats API splits endpoint has none. |

**Explicitly not queued:** a props version of the new pitcher-vs-lineup platoon
signal (`archer/pitcherPlatoon.ts`). It can't be backtested at all — the MLB Stats
API's handedness-split endpoint is a live rolling aggregate with no historical
time series to replay, the same limitation documented in `weatherEffect.ts`'s
header for the game-line version. There's nothing to test it against; it isn't a
"shelved" finding, just a dead end given today's free data sources.

## Data caveat

Every term and finding here was fit and validated on a **single partial season**
(the game-log archive is young — 2026, Mar 26–Jul 7 at time of writing). The
out-of-sample splits are *temporal within that season* (train early, validate
late), which is a real lookahead-safe test but weaker than multi-season. As the
archive grows, the wired betas are worth a re-fit and the shelved leads (esp.
extended rest, whose confound needs the break period) a re-check.

## Where this feeds

`projectPropHit`'s probability ranks the board and is the honest counterweight to
the raw trailing hit-rate. It also generates real prop `modelEv` in
`queries/oddsPool.ts` against the actual polled market price, the same way the
calibrated game-line models do — including the K-prop context shifts above, which
carry into `modelEv` too (see `oddsPool.ts`'s `contextShiftFor`), not just the
board's display ranking. The props edge screen (`npm run backtest:props`) sweeps
book-sharpness (f = how much of the model's edge the book already prices) so the
true edge can be read against the −5.7% floor; it applies the same wired shifts as
production so its verdicts stay honest.
