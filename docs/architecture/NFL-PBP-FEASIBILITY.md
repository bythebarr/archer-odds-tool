# NFL play-by-play feasibility audit (read-only, 2026-09-23)

> Status: audit written read-only; experiment 1 since run (see "Result log"
> at the end). The pbp layer is research-only (`src/lib/nfl/pbp/`, scripts) —
> no app route, model formula, schema, UI, provider, Discord, cron, dependency,
> or deployment change. It is the pre-registration input for NFL modeling and
> sits after `nfl-adapter.md` ("Phase 4/5 attempted") and `NFL-RESEARCH.md`
> (the experimental `nfl-elo` v0.1.0 research page).

## Why this audit exists

Two structurally different game models (Elo, SRS) are calibration-honest and
both lose to the closing line (Elo ATS −3.38% / ML −7.97%; SRS ATS −3.48% /
ML −9.36%). The cheap game-level context sweep (wind ~0.94%, temperature
~0.38%, rest ~0.22%, SOS −0.72% OOS, weekday/division null) did not change
that. The large untested family is play-level information from nflverse. This
document records what that data actually contains, what is knowable before
kickoff, and the experiment sequence a feature must survive before it earns
any weight.

### A correction to how the previous sweep should be read

`scripts/matchup-nfl-context.ts` measured residual-variance reduction against
**the SRS model's own residual** (`actualMargin − pred.projectedMargin`), not
against the **closing line's residual** (`actualMargin − closingSpread`). A
feature can improve our model and still be fully priced by the market (wind is
the obvious example — totals move on forecasts). Every experiment below uses
the market residual as the decisive target; model-residual improvement is
reported only as a secondary diagnostic.

## Data-source inventory (verified live 2026-09-23)

All sources are `github.com/nflverse/nflverse-data` release assets — free,
unkeyed, CSV (plus `.csv.gz` and Parquet). Sizes are the latest season's file.

| Dataset (release tag) | Seasons | Grain / keys | Size (latest) | Refresh observed | Notes |
|---|---|---|---|---|---|
| `pbp` | 1999–2026 (2026 = wk 1–2 so far) | play; `game_id` (`2025_01_ARI_NO`) + `play_id`; `old_game_id`, `nfl_api_id` | ~19 MB gz / ~20 MB parquet per season; 372 columns, ~48.8k rows (2025) | 2026 file updated 2026-09-23; **historical seasons re-published** (2024/2025 on 2026-08-13, 2020 on 2026-08-26) | Needs a real CSV parser (free-text `desc` has commas) or Parquet reader — neither is a repo dependency today |
| `pbp_participation` | 2016–2025 (+ `old_2023`) | play; `nflverse_game_id` + `play_id` | 49 MB (2025) | 2025 file last updated **2026-02-10**; **no 2026 file** | Published after the season, not weekly. Source/definitions change across eras (see below) |
| `ftn_charting` | 2022–2026 | play; `nflverse_game_id` + `nflverse_play_id` | 8 MB (2025) | Weekly (`date_pulled` 2026-09-22) | Blitzers, pass rushers, box count, play action, screen, RPO, motion, drops, catchable/contested |
| `pfr_advstats` (weekly) | 2018–2026 | player-game; `game_id`, `pfr_player_id` | <1 MB | Weekly | Pressures, hurries, hits, blitzes (pass + def), bad throws, drops, missed tackles |
| `snap_counts` | 2012–2026 | player-game; `game_id`, `pfr_player_id` | 0.5 MB gz | Weekly (2026-09-22) | Offense/defense/ST snaps & share — postgame by nature |
| `injuries` | 2009–2026 | player-week; `season`,`week`,`team`,`gsis_id` | 0.1 MB | Weekly (2026 wk 3 partial on Wed) | `report_status` (Out/Doubtful/Questionable/blank), `practice_status`. **No publication timestamp** |
| `weekly_rosters` | 2002–2026 | player-week; `gsis_id` + cross-ids (espn, pfr, pff, sleeper…) | 0.4 MB gz | Weekly | `status` ACT/INA/RES/DEV/CUT…; no timestamp |
| `rosters` | 1920–2026 | player-season | 0.4 MB gz | Daily-ish | Static bio/ids |
| `depth_charts` | 2001–2026 | **≤2024:** player-week (`week`, `depth_team`, no timestamp). **2025+:** ESPN snapshots with a UTC `dt` timestamp, daily | 10.8 MB gz (2026) | Daily (2026-09-16 … 09-23 present) | Schema changed in 2025; only 2025+ is genuinely as-of reconstructable |
| `nextgen_stats` | 2016–2026 | player-week | ~1 MB gz | Weekly | Passing/rushing/receiving NGS aggregates |
| `schedules` / `nfldata games.csv` | 1999–2026 | game; `game_id` | 0.5 MB gz | Multiple times daily | Closing spread/total (1999+), closing ML (partial 2006, full 2010+), `*_qb_id`, `temp`/`wind`, rest, roof, surface, coach, referee |
| `stats_team` | through 2026 | team-week | small | Weekly | Box-score aggregates; derivable from pbp anyway |
| `officials`, `contracts` | — | — | — | contracts stale since 2022 | Not candidates |

### Key `pbp` columns (2025 non-null share)

Identity/time: `game_id`, `play_id`, `season_type`, `week`, `game_date`,
`posteam`/`defteam` (94%), `home_team`, `drive`/`fixed_drive`, `series`.
Situation: `down` (84%), `ydstogo`, `yardline_100`, `qtr`,
`half_seconds_remaining`, `score_differential`, `goal_to_go`, `shotgun`,
`no_huddle`, `wp`. Outcome/value: `epa` (99%), `success`, `ep`, `wpa`,
`first_down`, `interception`, `fumble_lost`, `sack`, `qb_hit`, `penalty`.
Pass/rush: `pass`, `rush`, `qb_dropback`, `qb_scramble`, `air_yards`,
`yards_after_catch`, `cpoe` (36%), `xpass` (76%), `pass_oe` (74%),
`pass_location`, `run_location`, `run_gap`, `xyac_epa`. Players:
`passer_player_id`, `rusher_player_id`, `receiver_player_id` (GSIS ids, join
to rosters/injuries/participation). Filters: `special_teams_play`,
`aborted_play`, `qb_kneel`, `qb_spike`, `two_point_attempt`.
**Game-level leakage columns also present on every row:** `result`, `total`,
`spread_line`, `total_line`, `vegas_wp`, `vegas_home_wp`.

### Key `pbp_participation` columns

`offense_formation`, `offense_personnel`, `defense_personnel`,
`defenders_in_box`, `number_of_pass_rushers`, `offense_players`/
`defense_players` (GSIS id lists), `was_pressure`, `time_to_throw`, `route`,
`defense_man_zone_type`/`defense_coverage_type`. Era drift is real: in 2016
personnel is ~75% populated, `was_pressure`/`time_to_throw` ~39%, coverage
0%; in 2025 personnel/pressure 100%, coverage ~49%. `players_on_play` uses a
different id scheme in 2016. Any participation feature is a different
variable before and after ~2023.

## Pregame knowability and look-ahead risks

| Risk | Where | Severity | Handling |
|---|---|---|---|
| Final score / closing market on every pbp row | `pbp.result/total/spread_line/total_line/vegas_wp/vegas_home_wp` | Fatal if used | Column allow-list, never a deny-list; aggregation code must not see these columns |
| Same-week results | Any rolling aggregate | Fatal | Cutoff = the predicted game's week's **earliest kickoff** (the SRS harness convention) — TNF results never feed that week's Sunday games |
| Postseason games mixed into rolling windows | `season_type` | Moderate | Include POST plays in history only when they precede the cutoff; never predict from a window that straddles the cutoff |
| **EPA/WP/xpass/CP/xYAC are model outputs trained on multi-season data including seasons after the play** | `epa`, `wp`, `xpass`, `pass_oe`, `cpoe`, `xyac_epa` | Low–moderate (league-level structure, not game-specific) | Accept for EPA with a robustness arm that uses success rate + yards/play (model-free); treat `pass_oe` as a secondary arm |
| **Historical pbp files are silently re-published** | 2020, 2024, 2025 all re-released Aug 2026 | Moderate (reproducibility) | Freeze a dated local snapshot + SHA-256 per season file before any experiment; record the nflfastR version string |
| Recorded kickoff weather ≠ forecast available when betting | `games.temp/wind`, `pbp.weather` | Moderate for totals | Historical tests use observed weather as an **upper bound only**; a live feature needs an archived forecast source (not available free historically) |
| **QB id is the actual starter postgame; live rows hold a projection** | `games.away_qb_id/home_qb_id` | High (train/serve skew) | Never use as a feature. Reconstruct "expected starter" = previous game's starter unless the injury report lists him Out/Doubtful |
| Injury file has week, not publication time | `injuries` | Moderate | Treat `report_status` as the Friday (TNF: Wednesday-ish) final report; knowable pregame, but closing lines already price it — only useful vs *earlier* lines |
| Game-day inactives (`weekly_rosters.status = INA`) | ~90 min pregame | Moderate | Knowable before kickoff but after most bettable lines; and the close has priced it. No snapshot time in file |
| Depth charts ≤2024 have no timestamp; teams' published charts are often stale | `depth_charts` | High | Only 2025+ (timestamped) usable as-of; earlier weeks at most a weak prior |
| Participation data is published after the season | `pbp_participation` | High for live use | In-season features can use only **prior-season** participation aggregates |
| Snap counts / PFR advstats are postgame | `snap_counts`, `pfr_advstats` | Low if lagged | Only as lagged usage/pressure history strictly before the cutoff |
| Relocated franchise codes (OAK→LV, SD→LAC, STL→LA) | all team keys | Low | Explicit alias map in aggregation (same issue documented in `NFL-RESEARCH.md`) |
| Selection on the closing line during feature design | any | High (garden of forking paths) | Pre-register (below); test set opened once per family |

## Feature families

Classification: **D** = directly present; **L** = derivable without leakage
from pbp before the cutoff; **U** = requires unreliable assumptions;
**X** = requires paid or unavailable data.

| Family | Class | Source | As-of reconstruction | Comment |
|---|---|---|---|---|
| Offensive / defensive EPA per play (neutral situations) | L | `pbp.epa` | Team-season-to-date plays before cutoff, filtered: `pass==1 or rush==1`, `wp` 0.10–0.90 (or Q1–Q3 & \|score_diff\|≤14), excl. kneels/spikes/aborted; blended with shrunken prior season | The most-cited public NFL signal; opponent-adjust via the same ridge/SRS machinery as `srs/ratings.ts` |
| Success rate | L | `pbp.success` | Same window/filter | Lower variance than EPA; model-free robustness arm |
| Early-down pass rate & pass rate over expectation | L (PROE uses `xpass`, a model output) | `pbp.pass`, `down≤2`, `pass_oe` | Same window, neutral situations only | Style descriptor; weak alone, needed for matchup interaction |
| Explosive-play rate (off. and allowed) | L | `pbp.yards_gained` ≥20 pass / ≥10 rush (or EPA ≥ threshold) | Same window | Noisy; strong shrinkage required |
| Pressure / sack proxies | L (sacks, QB hits from pbp, 1999+); D (PFR pressures 2018+; FTN rushers/blitzers 2022+) | `pbp.sack`, `qb_hit`; `pfr_advstats`; `ftn_charting` | Lagged player-game / team-game sums before cutoff | Sack rate is part QB-driven — attribute to both sides |
| Neutral-situation pace | L | seconds between snaps from `game_seconds_remaining` within drives, neutral situations | Same window | Totals-side feature only |
| Red-zone TD rate | L | `yardline_100 ≤ 20` drives → TD | Same window, heavy shrinkage (Bayesian beta prior, league mean) | Historically very unstable; expected to fail, test anyway only as a totals term |
| Run/pass matchup interaction | L | off. rush EPA × def. rush EPA allowed, off. pass EPA × def. pass EPA allowed, weighted by off. early-down pass rate | Built from the above | This is the "stylistic matchup" hypothesis; must beat the additive EPA model, not the SRS baseline |
| QB availability & quality | L + U | pbp `passer_player_id` dropbacks, per-QB EPA/dropback; `injuries.report_status`; previous starter | Expected starter = last game's primary passer unless Out/Doubtful on the week's report; QB value = shrunken career EPA/dropback before cutoff | The largest known single-player effect. The "expected starter" rule is an assumption (U) — must be audited against actual starters for its error rate |
| Skill-player availability / usage | L (usage) + U (availability) | `snap_counts` 2012+, pbp targets/carries, `injuries` | Lagged snap/target share × player efficiency, zeroed if Out | Plausible for props; small for sides |
| Offensive line / defensive front availability | U | `injuries` + `depth_charts` (timestamped only 2025+) | Only 2025+ genuinely as-of | Historical depth charts untimestamped → insufficient history to test |
| Coverage / personnel / box tendencies | D but post-season only (2016–2025) | `pbp_participation` | Prior-season aggregates only in-season | Era drift across sources; secondary |
| Weather interactions (wind × team pass rate, wind × kicking) | L historically as upper bound; X live | `games.wind/temp`, pbp pass rate | Observed, not forecast | Only as an interaction, never a generic bonus |
| True CLV (entry vs close) | X | — | — | nflverse has closing lines only; no free historical opening/intra-week lines |
| Historical NFL player-prop odds | X | — | — | No free archive; props can't be ROI-tested historically |
| Charting grades (PFF), tracking data | X | — | — | Paid |
| Forecast weather archive | X | — | — | Observed only |

### Rolling-window rules (all L features)

1. Cutoff `t*` = earliest kickoff of the predicted game's NFL week.
2. Include only plays from games with `game_date < t*` (date-only; week-level
   cutoff makes intraday ordering irrelevant).
3. Current-season estimate `x_cur` over `n_cur` plays; prior `x_prior` =
   previous season's team value regressed toward league mean; posterior
   `x = (n_cur·x_cur + k·x_prior) / (n_cur + k)` with `k` fit **on the train
   window only** per family. No fixed L1/L3/L5/L10 windows; if recency
   weighting is tested, it is one exponential half-life parameter, also fit
   on train only.
4. League mean for centering is computed from plays before `t*` only.
5. Opponent adjustment: ridge regression of play-level EPA on offense and
   defense team indicators over the same window (λ fit on train), not raw
   averages.
6. Unit test per family: a synthetic game injected at `t*` must not change any
   feature value for games with cutoff ≤ `t*`.

## Pre-registered experimental sequence

**Frozen baseline (B0):** the SRS walk-forward (`srs/backtestHarness.ts`)
with its fitted constants, *and* the closing line itself. Both are reported;
the market is the bar that matters.

**Splits (by season, never random):**

- Train: 2007–2017 regular season (fit shrinkage `k`, ridge λ, blend
  weights).
- Validation: 2018–2021 (model/family selection, one pass per family).
- Test: 2022–2025 (opened **once**, after the family list and all
  hyperparameters are frozen and written into this doc). Roughly 1,000+
  graded games.
- 2026 onward: forward-only, via the existing `PredictionRun`/`ModelPrediction`
  capture.

**Order (one family at a time, each vs. B0 and vs. the previous kept set):**

1. Opponent-adjusted neutral EPA/play (off/def), shrunken — with success-rate
   and yards/play arms as model-free checks.
2. QB expected-starter + QB value (the only candidate with a plausibly large
   effect; also the one most priced by the close).
3. Early-down pass rate / PROE and the run/pass matchup interaction.
4. Pressure/sack proxies (pbp sacks+hits 1999+; PFR pressures only if 2018+
   validation still has power).
5. Explosive rate, pace, red zone — totals target.
6. Weather × pass-rate interaction — totals target, labeled upper-bound.

**Metrics (all out-of-sample):**

- Primary: correlation `r` between (model margin − closing spread) and
  (actual margin − closing spread); same for totals. Equivalent: OOS
  reduction in **market-residual** variance.
- Secondary: Brier and log loss for win probability (vs. B0 and vs. the
  de-vigged closing ML), reliability curve / calibration slope, ATS and ML
  ROI at the close with edge-bucket monotonicity, model-residual variance
  (diagnostic only).
- Uncertainty: 2,000 block-bootstrap resamples **by week** (games within a
  week are correlated) for every metric; report 95% intervals.

**Power anchor.** With `r` between model disagreement and market residual,
ATS win rate betting every game ≈ `0.5 + arcsin(r)/π`. Break-even at −110 is
52.38%, i.e. `r ≈ 0.075` (≈0.56% of market-residual variance). With ~1,000
test games, SE(r) ≈ 0.032, so the minimum resolvable effect at 2σ is
`r ≈ 0.063`. ATS ROI alone has SE ≈ 3% at n≈1,000 and cannot distinguish
−3% from 0% — which is why ROI is secondary.

**Keep criteria (all must hold for a family):**

- Validation market-residual `r` improvement ≥ 0.02 over the prior kept set,
  and the bootstrap 95% interval for the improvement excludes 0.
- Brier/log loss not worse than B0 on validation (interval upper bound < +0.001
  Brier).
- Effect sign consistent in ≥3 of 4 validation seasons.
- No reliance on a column outside the allow-list; passes the as-of unit test.

**Reject criteria (any one):**

- In-sample-only improvement (the SOS pattern: train gain, validation loss).
- Improvement only on model residual, not market residual.
- Edge-bucket ROI non-monotone *and* `r` interval spans 0.
- Effect concentrated in one season or driven by < 5% of games.
- Needs untimestamped depth charts, postgame QB ids, or observed-weather
  values to work.
- Hit rate alone, one slate, or any single game (e.g. the 2026-09-21
  Giants–Rams result) is never cited as evidence.

**Final gate:** after the test set is opened once, the model stays
`lifecycle: "experimental"` unless test-window market-residual `r` ≥ 0.075
with a bootstrap interval excluding 0 **and** ATS ROI at the close ≥ 0
point estimate. Nothing reaches `nflAdapter.listPlays()` or Discord on
backtest evidence alone; forward capture must corroborate.

## Game model first, or a player-projection foundation first?

**Game model first**, with one player-level piece: QB value.

- Every team feature above is a pbp aggregation; a player-projection layer
  adds identity/usage/availability modeling without a way to validate it on
  the target that matters for sides (no free historical prop odds, so player
  projections can only be scored on outcomes, not on market beating).
- The one player effect big enough to matter for sides is the QB, and it can
  be built from pbp (`passer_player_id` + dropback EPA) plus the injury
  report without a general projection framework.
- Availability for OL/DL cannot be tested historically (untimestamped depth
  charts before 2025), so a shared player foundation would carry an
  untestable component from day one.
- A player-projection foundation becomes justified when props are the target
  (project priority: props pricing after NFL core) — and it should then reuse
  the same as-of pbp aggregation layer built here, so no work is wasted.

## Engineering prerequisites (for the next task, not done here)

- A CSV parser (or Parquet reader) dependency — `games.ts`'s comma split is
  unsafe for pbp. Decide explicitly; adding it is a package change.
- A local, hashed, per-season pbp cache (~19 MB × 27 seasons ≈ 0.5 GB gz) in a
  gitignored directory, not in Postgres.
- A column allow-list reader that never loads leakage columns into memory.
- A team-week aggregate table built once from the cache, keyed
  `(season, week, team)`, containing only plays strictly before each week's
  cutoff.

## Result log

### Experiment 1 — opponent-adjusted neutral EPA/play (2026-09-23): **rejected for sides**

Built: `src/lib/nfl/pbp/` (dependency-free streaming CSV parser, hashed
per-season cache with column allow-list, per-team-game neutral aggregates,
as-of ridge ratings) and `npm run experiment:nfl:epa`. Data: nflverse pbp
2006–2025, 708,124 scrimmage plays, 10,862 team-game observations; SHA-256 of
every season file in `.cache/nflverse/pbp/manifest.json`. Shrinkage fit
market-blind on train: k = 600 phantom plays for every metric, season carry
0.6 (pass EPA 0.8). Common sample: train 2,800 / validation 1,032 games. Test
2022–2025 (1,087 games) **still sealed**.

Validation 2018–2021 (95% week-block bootstrap intervals):

| Model | r vs close residual | RMSE (close 13.19) | ATS ≥1pt at close | Brier (close 0.2104) |
|---|---|---|---|---|
| B0 SRS (frozen) | 0.039 [−0.019, 0.098] | 14.33 | +1.3% [−4.5, 7.1] | 0.2400 |
| EPA/play | −0.005 [−0.063, 0.049] | 13.78 | −2.1% [−8.4, 4.3] | 0.2244 |
| Success rate (model-free) | 0.029 [−0.029, 0.086] | 13.82 | −0.2% [−7.0, 6.5] | 0.2262 |
| Pass EPA + Rush EPA | 0.016 [−0.044, 0.070] | 13.75 | +0.3% [−6.0, 6.8] | 0.2252 |
| SRS + EPA/play | 0.004 [−0.055, 0.057] | 13.74 | +0.2% [−5.9, 6.7] | 0.2241 |

Per-season r for EPA/play: 2018 −0.001, 2019 −0.020, 2020 +0.103, 2021
−0.067 — sign-consistent in 1 of 4 seasons.

Verdict against the keep/reject rules: **rejected** — no arm improves r over
B0, every interval spans 0, no arm is near the 0.075 break-even, and the one
positive season is 2020 (empty stadiums, an obvious one-off). Train-window r
is also ≈0 for every arm, so this is not a validation-only fluke.

What it *does* show: EPA ratings are a clearly better **game predictor** than
SRS (RMSE 13.78 vs 14.33; Brier 0.2244 vs 0.2400) — but the closing line is
better still (13.19 / 0.2104), and the part of the outcome EPA explains is
already in the close. Public, team-level efficiency is priced. This is the
third independent model (Elo, SRS, EPA) with the same answer on sides.

Consequence for the sequence: families 3–6 (pass-rate/matchup, pressure,
explosive/pace/red zone, weather interaction) are team-level refinements of
the same public information and are now low-prior for sides; they are
de-prioritised, not run. Family 2 (QB availability) remains the only
side-market candidate with a plausible mechanism (information timing), and it
needs pre-close lines to be tested fairly. The EPA layer is kept as the
game-context input for **player props**, where the market is thinner — see
the next step in `nfl-adapter.md`/this doc.
