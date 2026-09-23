# NFL player-prop projection model (research, 2026-09-23)

> Status: **experimental, validated against outcomes, not yet priced against
> sportsbook lines.** Model: `src/lib/nfl/props/`, frozen as v1.0.0. Served
> read-only at `/nfl/props` from forward-captured `PredictionRun`s
> (`npm run capture:nfl:props`). No odds provider, Discord, cron or schema
> change. Follows the game-line result in `NFL-PBP-FEASIBILITY.md`: sides are
> priced; props are the thinner market.

## Why props, and what "validated" means here

Three independent NFL game models (Elo, SRS, EPA) are honest predictors and
all lose to the closing line. Props are set per player across hundreds of
markets a week, which is where this project's MLB calibration history also
found its only surviving edge (pitcher strikeouts).

There is **no free archive of historical NFL prop odds**. So this model is
validated the only honest way available: out-of-sample projection quality
against real outcomes, versus the naive baselines every props app shows
(season average and last-5 average). Beating those is necessary, not
sufficient. Actual betting edge needs live lines and forward capture — the
next step, below.

## Data

| Source (nflverse release) | Use |
|---|---|
| `stats_player/stats_player_week_<season>` | Official box score — the thing props settle on |
| `snap_counts/snap_counts_<season>` (2013+; the 2012 file is an upstream 103-byte stub) | Who actually played, so games with zero stats count as real zeros (≈700–900 per season) |
| `players/players.csv` | PFR → GSIS id crosswalk (≈99.8% of skill snap rows map) |
| `nfldata/games.csv` | Pregame spread and total (game script) |

All cached and SHA-256-hashed under `.cache/nflverse/<tag>/` by
`src/lib/nfl/nflverse.ts`, allow-listed columns only. 81,849 skill-player
games and 6,814 team games, 2013–2025.

## Model

Every projection is **volume × share × efficiency**, and each piece is shrunk
(empirical Bayes) toward a population prior:

| Market | Projection |
|---|---|
| Receptions | team targets × target share × catch rate |
| Receiving yards | team targets × target share × yards/target × opponent factor |
| Rush attempts | team carries × carry share |
| Rushing yards | team carries × carry share × yards/carry × opponent factor |
| Pass attempts | team attempts × attempt share |
| Completions | team attempts × attempt share × completion rate |
| Passing yards | team attempts × attempt share × yards/attempt × opponent factor |

- **Shares:** exponentially decayed per game played. The prior is the league's
  per-snap rate × the player's own lagged snap share, so a full-time WR1 and a
  rotational WR4 start from different priors.
- **Team volume:** linear in the team's recent volume, the opponent's volume
  allowed, and the pregame spread and total.
- **Opponent factor:** the defense's decayed yards allowed per opportunity (by
  receiver position for targets) relative to league, shrunk, then damped by γ.
- **Distribution:** the empirical distribution of actual/projected ratios by
  projection decile turns a mean into P(over line), followed by a per-family
  logistic recalibration.
- **As-of:** `engine.ts` snapshots every player-game from state strictly
  before its week, then folds the week in (tested: altering a game's own or
  later outcomes never changes its snapshot).

### Fitted on train 2014–2019 only (market-blind)

- Usage: half-life 4 games, season carry 0.5. Target share k=30, carry share
  k=10, attempt share k=100 (phantom team-opportunities).
- Efficiency: half-life 16 games, carry 0.5. Catch k=30, yards/target k=100,
  yards/carry k=100, completion k=100, yards/attempt k=300.
- Team volume: half-life 8. Targets = −2.07 + 0.655·team + 0.132·opp allowed
  − 0.004·spread + 0.203·total (RMSE 7.9). Carries = 7.41 + 0.558·team +
  0.389·opp + 0.098·spread − 0.134·total (RMSE 7.2). Favorites run and
  high-total games throw, as expected.
- Opponent: half-life 16, k=300, γ = 0.75 for receiving, rushing and passing.
- Recalibration σ(a + b·logit p): receiving b=0.861, rushing b=0.820, passing
  b=0.939 (all < 1 → tails pulled in).

Recency is fast for **role** (4-game half-life) and slow for **efficiency**
(16 games, heavy shrinkage). That matches the public-analytics consensus that
usage is sticky and signal-rich while per-touch efficiency is mostly noise.

## Result — validation 2020–2022 (untouched during fitting)

"Book-proxy line" = the player's season average rounded to x.5, the line a
naive app would show. Δ is model − season-average Brier, with a 95%
week-block bootstrap interval.

| Market | n | MAE model / season / L5 | Brier @ proxy line model / season / L5 | Δ Brier [95% CI] |
|---|---|---|---|---|
| Receptions | 7,042 | 1.75 / 1.87 / 1.83 | 0.2260 / 0.2363 / 0.2318 | −0.0103 [−0.0142, −0.0070] |
| Receiving yards | 7,042 | 23.84 / 25.43 / 25.07 | 0.2263 / 0.2376 / 0.2335 | −0.0112 [−0.0143, −0.0083] |
| Rush attempts | 2,892 | 4.26 / 4.50 / 4.49 | 0.2311 / 0.2437 / 0.2385 | −0.0126 [−0.0176, −0.0080] |
| Rushing yards | 2,892 | 25.37 / 26.79 / 26.84 | 0.2315 / 0.2414 / 0.2366 | −0.0099 [−0.0151, −0.0048] |
| Pass attempts | 1,361 | 7.02 / 7.44 / 7.61 | 0.2305 / 0.2351 / 0.2375 | −0.0046 [−0.0094, −0.0005] |
| Completions | 1,361 | 5.02 / 5.31 / 5.45 | 0.2295 / 0.2349 / 0.2369 | −0.0054 [−0.0100, −0.0007] |
| Passing yards | 1,361 | 60.36 / 65.13 / 66.25 | 0.2300 / 0.2358 / 0.2371 | −0.0058 [−0.0096, −0.0021] |

Pooled calibration at proxy lines (predicted → observed): 0.06→0.03,
0.16→0.12, 0.26→0.26, 0.36→0.35, 0.45→0.45, 0.54→0.53, 0.64→0.65, 0.74→0.71,
0.84→0.74 (n=141), 0.92→0.89 (n=35).

**Verdict:** the model beats both naive baselines on every market, every
interval excludes zero, and it is calibrated through the range where almost
all volume sits (0.2–0.7). The 0.84 bucket is still ~10 points hot on a small
sample. Anything above ~0.8 should be displayed as "strong" rather than
trusted as a price until forward data confirms it. Test 2023–2025 remains
sealed.

## What this does not show

- **It is not evidence of edge against sportsbooks.** Books are far better
  than a season average. Whether this model beats their lines is unknown
  until live lines are captured and graded forward.
- Availability isn't modeled. Projections are conditional on the player
  playing (props void otherwise). A teammate's absence only enters through
  lagged shares, which is the obvious next feature (injury report → share
  redistribution).
- No touchdown, longest-reception, or anytime-scorer markets — those are
  low-count or extreme-value markets with different distributions.

## Serving the model (built 2026-09-23)

- **Frozen:** `src/lib/nfl/props/frozen/nfl-props-v1.0.0.json` holds every
  fitted number: decay parameters per component group, shrinkage, volume
  coefficients, opponent damping, the per-market ratio distributions (201
  quantiles per bin), calibrators, the validation table, and the SHA-256 of
  every data file. It is written only by
  `NFL_PROPS_FREEZE=1 npm run experiment:nfl:props`, and `frozen.ts`
  refuses to load a version the code doesn't declare. Refitting means bumping
  `NFL_PROPS_MODEL_VERSION`.
- **Live projection:** `live.ts` replays 2013 → last completed week with the
  frozen parameters. It projects the next week for players whose latest game
  was for a team playing that week, applies the shared eligibility rules
  (`eligibility.ts`, the same code the experiment uses), drops Out/Doubtful
  from the official injury report, and flags Questionable. Files for the
  in-progress season re-download once they're 3h old; historical files stay
  pinned.
- **Forward capture:** `npm run capture:nfl:props` (`--dry-run`,
  `--confirm-rerun`) writes one `ModelPrediction` per (ESPN event,
  `player_<market>`, GSIS id) under `nfl-props` v1.0.0, lifecycle
  `experimental`, with `probability` null, the mean plus breakdown in
  `projection`, and the validation table in `calibrationSnapshot`. No schema
  change was needed. Run it Friday/Saturday, after the final injury report.
- **Provider-agnostic pricing:** `pricing.ts` takes any `PropLineQuote`
  (player, market, line, over/under American price, book, source) and returns
  calibrated over/under, fair odds, de-vigged market probability and EV. A
  future odds provider only has to produce quotes; `playerNameKey` handles
  book-label → nflverse name matching.
- **UI:** `/nfl/props` (linked from `/nfl`) reads the latest run: holdout
  scorecard, game rail, market tabs, search and sort, then one row per player
  with projection vs. season/L5 averages, a line box giving calibrated O/U and
  fair odds, optional prices giving EV, and a "Why" panel showing the
  projection as its equation. Lines entered stay in the browser only.

## Remaining path to a priced product

1. **Pick the odds provider**, then write one adapter producing
   `PropLineQuote`s through an explicit market allow-list (like
   `src/lib/props/propMarkets.ts`). Only then does NFL need prop storage
   (`PlayerPropSnapshot`/`CurrentPlayerPropLine` are MLB-keyed).
2. **Attach quotes at capture** (`marketSnapshot` + `probability` at the
   quoted line). That is the real edge test.
3. **Grading job:** settle each stored projection against the nflverse box
   score after the week, and track calibration and CLV forward.
4. **Model v1.1 candidates**, each through the same train/validation gate:
   teammate-absence share redistribution (injury report → vacated targets),
   QB-change adjustment for receivers, touchdown markets.
5. **Automation:** a Friday/Saturday cron for capture once the runtime has a
   writable cache directory.
