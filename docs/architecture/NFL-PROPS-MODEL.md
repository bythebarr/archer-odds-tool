# NFL player-prop projection model (research, 2026-09-23)

> Status: **experimental, validated against outcomes, not yet priced against
> sportsbook lines.** Model: `src/lib/nfl/props/`, frozen as v1.4.0 (19 markets). Served
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

## v1.1 (2026-09-23): injury-report availability — one of three candidates kept

Source: the official injury report (`injuries.ts`, nflverse 2009+). It's
published before kickoff, and its designations are reliable: across
2013–2025, skill players listed **Out** played 0–1% of the time and
**Doubtful** 0–4%, while **Questionable** played 52–72%. Out/Doubtful count as
absent; Questionable is only flagged.

Vacated usage = the absent player's own decayed share × 0.5^(k/4), where k =
team games since he last played (4 = the usage half-life). A fresh absence
frees his full share. A long one frees little, because teammates' lagged
shares have already absorbed it (`availability.ts`; tested). Each candidate
was fit on train on top of frozen v1.0 and tested **alone** on validation
(`NFL_V11_VARIANT=car|tgt|qb npm run experiment:nfl:props`):

| Candidate | Fit (train) | Validation Δ Brier @ proxy line vs v1.0 [95% CI] | Verdict |
|---|---|---|---|
| Carry redistribution | same-position 0.285, other 0.034 | rush att affected rows (n=774) **−0.0097 [−0.0133, −0.0063]**; rush yds **−0.0051 [−0.0084, −0.0025]**; all rush rows also significant | **Kept** |
| Target redistribution | same-position 0.373, other 0.098 | receptions −0.0005 [−0.0013, +0.0003]; rec yds −0.0004 [−0.0012, +0.0004], MAE worse (23.82 → 24.01) | Rejected |
| QB out (starter ruled out) | targets ×0.96, catch ×0.967, yds/target ×0.913 (210 train rows) | rec yds −0.0002 [−0.0006, +0.0002] | Rejected (not proven; sample too small) |

Why carries and not targets: a backfield usually has one clear heir, while
vacated targets spread across several receivers and the QB's read
progression. That's a hypothesis, not tested here. The targets form was
not re-tuned after it failed, because that would be fitting to the
validation window.

**v1.1.0 vs season average (validation):** rush attempts Δ −0.0151
[−0.0203, −0.0104] (v1.0: −0.0126); rushing yards −0.0115 [−0.0167, −0.0065]
(v1.0: −0.0099). Other markets are unchanged. Frozen with
`NFL_V11_VARIANT=car NFL_PROPS_PRIMARY=v11 NFL_PROPS_FREEZE=1`. Live
projections apply it from the week's report, and the board shows a
**+usage** tag naming the absent teammate. Test 2023–2025 remains sealed.

## v1.2 (2026-09-23): touchdown markets added; depth-aware targets rejected

### Touchdown markets — kept (`td.ts`, `npm run experiment:nfl:props:td`)

Built on the frozen v1.1 engine. Usage and team decay and all shrinkage are
reused, and only TD parameters are fit (train 2014–2019):

- **Team TDs** = −0.468 + 0.1295 × market-implied team points − 0.044 ×
  recent TDs/game (implied points = total/2 + team spread/2). The market's
  implied total carries essentially all the signal; recent TD rate adds
  nothing.
- **Player TD share** = own decayed TDs (16-game half-life), shrunk with
  k = 64 phantom team TDs toward a role prior of 0.278 × carry share +
  0.696 × target share. The shrinkage is heavy, as it should be for rare
  events. An earlier grid topped out at k = 32, at its edge, so the grid was
  extended on train before freezing.
- **Anytime** P = 1 − e^(−λ) with λ = team TDs × TD share. **Passing TDs**
  are Poisson with λ = team TDs × team pass-TD fraction (k = 20) × QB attempt
  share. Each gets a logistic recalibration on train, and so does every
  baseline, so the comparison is between information, not calibration.

Validation 2020–2022, log loss vs. the naive season rate (95% week-block CI):

| Market | n | Log loss model / season / L5 | Δ vs season |
|---|---|---|---|
| Anytime TD | 8,818 | 0.5592 / 0.5818 / 0.5778 | −0.0226 [−0.0268, −0.0178] |
| Pass TDs o0.5 | 1,361 | 0.4881 / 0.5482 / 0.5385 | −0.0601 [−0.0879, −0.0368] |
| Pass TDs o1.5 | 1,361 | 0.6522 / 0.6793 / 0.6792 | −0.0271 [−0.0411, −0.0139] |
| Pass TDs o2.5 | 1,361 | 0.4578 / 0.4971 / 0.4851 | −0.0393 [−0.0539, −0.0252] |

Calibration holds through the range where the volume sits (anytime:
0.16→0.16, 0.25→0.25, 0.34→0.35, 0.44→0.47). **Frozen as v1.2.0 = v1.1.0
byte-for-byte + a `td` block** (tested). The board adds Anytime TD, showing
calibrated TD chance, fair odds, and EV at a typed price, and Pass TDs
(a line → over/under).

**Bug found and fixed along the way:** `LogisticCalibrator` used undamped
Newton steps, which diverged on spiky inputs (raw season TD rates piled at
0 and 1; b reached −1.5M). It now uses step halving on the log-likelihood.
Re-running the main experiment reproduces every shipped number exactly,
including the frozen v1.0/v1.1 calibrators, so the bug never affected
anything served.

### Depth-aware target redistribution — rejected

Pre-specified retry of v1.1's failed target form: an additive share bump
weighted by (1 − the receiver's snap share), so whoever steps into the
vacated snaps gains most. Fit on train (same-position 0.302, other 0.043),
tested alone (`NFL_V11_VARIANT=tgtDepth`). Validation, affected rows:
receptions +0.0003 [−0.0011, +0.0017]; receiving yards +0.0004
[−0.0008, +0.0016], with MAE worse (23.82 → 24.19). Two structurally
different target forms have now failed, which is fair evidence that for
bettable receivers (≥3 targets/game), injury-report target redistribution
adds nothing beyond their lagged shares. The code path stays, off, for
reproducibility.

### QB quality differential — deferred

The binary QB-out flag had only 210 train receiver rows and couldn't
resolve an effect. A backup-quality version would split that same sample
further, and historical depth charts aren't timestamped before 2025
(`NFL-PBP-FEASIBILITY.md`), so the backup's identity isn't knowable
pregame for most of the train window. Revisit when 2025+ timestamped depth
charts accumulate a usable sample.

## v1.3 (2026-09-23): combos, interceptions, 2+ TDs — all four kept

Built on frozen v1.2 through the new shared replayer (`replay.ts`). The
live projector and every market experiment now read the same pre-week
state; the refactor reproduced all 851 live projections to 9 decimals.
Script: `npm run experiment:nfl:props:extras` (`extras.ts`).

- **Rush + receiving yards** (RB/WR/TE) and **pass + rush yards** (QB): the
  mean is the sum of the frozen marginal projections. The distribution is
  its own empirical ratio distribution fit on the combined stat, so it
  carries the real correlation between the parts rather than assuming
  independence.
- **Interceptions thrown:** Poisson with λ = projected attempts × INT rate
  (shrunk with k = 400 phantom attempts toward the league) × defense INT
  factor (k = 300, γ = 0.25). The heavy shrinkage and weak defense weight
  are the finding: INTs are mostly noise, and the model wins by not chasing
  a QB's recent INT streak, which is exactly what the naive average does.
- **2+ TDs:** the anytime-TD Poisson rate at ≥2, with its own calibration.

Validation 2020–2022 vs. the season-average baseline (95% week-block CI):

| Market | n | Metric model / season / L5 | Δ vs season |
|---|---|---|---|
| Rush + rec yards | 8,493 | Brier 0.2301 / 0.2411 / 0.2367 (MAE 27.3 / 28.9 / 28.7) | −0.0110 [−0.0145, −0.0082] |
| Pass + rush yards | 1,361 | Brier 0.2301 / 0.2360 / 0.2363 (MAE 62.0 / 66.6 / 67.8) | −0.0059 [−0.0093, −0.0026] |
| Interceptions o0.5 | 1,361 | log loss 0.6968 / 0.7417 / 0.7260 | −0.0449 [−0.0709, −0.0234] |
| Interceptions o1.5 | 1,361 | log loss 0.4587 / 0.5063 / 0.4947 | −0.0476 [−0.0578, −0.0379] |
| 2+ TDs | 8,818 | log loss 0.1921 / 0.2035 / 0.2043 | −0.0114 [−0.0153, −0.0077] |

**Frozen as v1.3.0 = v1.2.0 byte-for-byte + an `extras` block** (tested,
along with v1.2 ⊃ v1.1). The board now has 13 market tabs. Combos show their
parts (rush yds + rec yds = total), interceptions show attempts × INT rate
× defense factor, and 2+ TDs uses the yes/no layout.

## v1.4 (2026-09-23): longest plays, kickers, first TD scorer — all six kept

New data: `src/lib/nfl/pbp/playExtras.ts` makes one streaming pass over each
season's raw play-by-play (column allow-list enforced) for every single-play
gain, each player-game's longest reception / rush / completion, and each
game's first TD scorer. That includes defensive and return TDs, which beat
every offensive player to it. Kickers come from the weekly box score
(`kickerGames.ts`). Script: `npm run experiment:nfl:props:batchb` (`batchB.ts`).

- **Longest reception / rush / completion:**
  P(longest > L) = 1 − exp(−μ · S(L)). μ = the frozen model's projected
  receptions / carries / completions. S = the position's single-play
  survival curve from train (reception mean: WR 13.0, TE 11.1, RB 8.1 yds),
  stretched by the player's shrunk yards per touch. The board shows the
  **median** longest: on longest rush, the *mean* has higher error than the
  season average (9.5 vs 8.8 yds) because longest plays are right-skewed,
  but the probability at the line, which is what prices a bet, beats it.
- **Kickers:** FG made ~ Poisson, λ = 2.083 − 0.390·implied pts + 3.200·
  projected team TDs + 0.478·recent FGM (half-life 32 games, 2 prior games).
  Substituting the TD model's linear dependence on implied points, the net
  is +0.025 per implied point, −0.14 per recent team TD/game (TD-heavy teams
  kick fewer FGs), plus the kicker's own rate. XP = 0.937 × team TDs.
  Kicking points = 3λ + XP, with its own empirical distribution.
- **First TD scorer:** P = (λ_player / λ_game)·(1 − e^(−λ_game)), where
  λ_game = both teams' projected TDs + δ = 0.2 non-offensive TDs/game (fit
  on train).

Validation 2020–2022 vs. season average (95% week-block CI):

| Market | n | Metric model / season / L5 | Δ vs season |
|---|---|---|---|
| Longest reception | 7,033 | Brier 0.2228 / 0.2342 / 0.2317 | −0.0114 [−0.0137, −0.0093] |
| Longest rush | 2,892 | Brier 0.2148 / 0.2244 / 0.2216 | −0.0095 [−0.0128, −0.0063] |
| Longest completion | 1,361 | Brier 0.2215 / 0.2261 / 0.2286 | −0.0046 [−0.0075, −0.0020] |
| FG made o0.5 / o1.5 / o2.5 | 1,557 | log loss 0.462 / 0.688 / 0.533 vs 0.537 / 0.724 / 0.577 | −0.075 / −0.036 / −0.045, all exclude 0 |
| Kicking points | 1,557 | Brier 0.2254 / 0.2357 / 0.2276 | −0.0103 [−0.0153, −0.0059] |
| First TD scorer | 8,818 | log loss 0.2329 / 0.2400 / 0.2397 | −0.0071 [−0.0098, −0.0044] |

**Weakest two:** longest completion and kicking points cleared validation,
but their train-window edge was not significant (−0.0012 [−0.0031, +0.0007]
and −0.0007 [−0.0047, +0.0034]). They are kept under the rule, and flagged
as the first candidates to drop if the sealed test window disagrees.

**Frozen as v1.4.0 = v1.3.0 byte-for-byte + a `batchB` block** (tested:
v1.4 ⊃ v1.3 ⊃ v1.2 ⊃ v1.1). Longest-play pricing needs more than one mean,
so `pOver` takes `aux` = {expected touches, yards per touch, position},
stored with each captured prediction.

### Live-serving fix found while shipping v1.4: roster status

The FG tab showed 47 kickers for 32 teams. Candidates were "players whose
last game was for a team playing this week", which keeps cut and
injured-reserve players (IR players aren't on the weekly injury report).
The live projector now reads nflverse's weekly roster for the target week
(falling back to the latest published week, with a warning) and requires
status ACT. A player who changed teams is projected for his **new** team,
carrying his own usage history. That's how team changers appear in the
validated population too. Week 3: 32 kickers for 32 teams, and 54
exclusions (28 not on a roster, 12 reserve, 12 practice squad, 2 other).

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
4. **Coverage roadmap**, each market through the same gate:
   - ~~*Batch B:* longest plays, kickers, first TD scorer~~ (done, v1.4).
   - *Batch C:* defensive props: sacks, tackles + assists, needing defensive
     snap counts and the box score's `def_*` columns.
   - The QB quality differential, once 2025+ depth charts give a pregame
     backup identity.
   - Then open the sealed 2023–2025 test window **once**, when the market
     list is final.
5. **Automation:** a Friday/Saturday cron for capture once the runtime has a
   writable cache directory.
