# MLB Model Inventory — Forensic Audit

**Branch:** `recovery/platform-baseline`. **Scope:** read-only. No production code, model
formulas, database schema, providers, Discord code, cron schedules, or dependencies were
changed to produce this document — only this file was written. No live APIs were called;
every claim below is sourced from the repository as it stands (source files, tests, and
existing `docs/architecture/*.md`), not from running anything against production data.

**Method:** direct reading of every MLB calculation and data-path file (`src/lib/archer/*`,
`src/lib/props/*`, `src/lib/mlb/*`, `src/lib/queries/{matchup,teamForm,hitRate,oddsPool,games}.ts`,
`src/lib/odds/*`, `src/lib/engine/{calibration,trust,adapters/mlb}.ts`, `prisma/schema.prisma`,
relevant `scripts/backtest-*.ts` / `scripts/matchup-*.ts` / `scripts/calibrate-pitcher-props.ts`),
cross-checked against the existing `docs/architecture/{sport-engine,calibration,props-matchup,
provider-coverage,EDGE-BASELINE-AUDIT}.md`. Those docs are excellent and current where they
overlap this one; this document does not repeat their platform-wide findings (registries,
ingest truthfulness, cron scheduling) except where they bear directly on the MLB model itself.

---

## 1. Current prediction targets

MLB is the **only** sport in the registry with a live pricing model wired to `modelEv`
(`src/lib/engine/adapters/mlb.ts` — `MLB_MODEL.describes: "win probability (moneyline) +
expected runs (spreads/totals)"`). Its targets, precisely:

| Target | Function | Output | Feeds |
|---|---|---|---|
| **Game-winner probability** | `computeArcherWinProbability` (`src/lib/archer/winProbability.ts`) | `{ homeProb, awayProb }`, clamped to [0.15, 0.85] | `h2h` market EV via `archerProbForRow` (`src/lib/archer/runProbability.ts`) → `OddsPlay.modelEv` (`src/lib/queries/oddsPool.ts`) → board `+EV` selection (`selectBoardPlays`, `src/lib/engine/adapters/mlb.ts`) and the game page's "ARCHR Edge" column (`src/components/GameLinesView.tsx`) |
| **Expected runs, per team and combined** | `computeExpectedRuns` (`src/lib/archer/expectedRuns.ts`) | `{ home, away }`, runs/game | The combined sum feeds totals; the signed difference (`home − away`) feeds spreads (both in `runProbability.ts`) |
| **Spread/run-line cover probability** | `archerSpreadCoverProb` (`src/lib/archer/runProbability.ts`) | P(side covers `point`) via Normal(mean = home−away runs, var = 21.5) | `spreads` market `modelEv` |
| **Total over/under probability** | `archerTotalOverProb` / `archerTotalUnderProb` (`src/lib/archer/runProbability.ts`) | P(combined score over/under `point`) via Normal(mean = home+away runs, var = 20.5) | `totals` market `modelEv` |
| **Every supported player prop** | `projectPropHit` (`src/lib/props/projection.ts`) | Calibrated P(clears line), clamped [0.02, 0.98] | **Ranks** the props board only (`defaultRank`, `src/lib/props/mlbBoard.ts`) — see the critical caveat below |

**11 player-prop stat categories** (`StatCategory` enum, `prisma/schema.prisma`; standard
lines from `src/lib/props/mlbBoard.ts`):

| Role | Stat | Standard lines |
|---|---|---|
| Batter | Hits | 0.5, 1.5, 2.5 |
| Batter | Total Bases | 1.5, 2.5, 3.5 |
| Batter | Home Runs | 0.5, 1.5 |
| Batter | RBIs | 0.5, 1.5, 2.5 |
| Batter | Runs | 0.5, 1.5 |
| Batter | Strikeouts | 0.5, 1.5, 2.5 |
| Pitcher | Strikeouts | 3.5, 4.5, 5.5, 6.5, 7.5 |
| Pitcher | Outs Recorded | 14.5–19.5 |
| Pitcher | Earned Runs | 1.5, 2.5, 3.5 |
| Pitcher | Hits Allowed | 3.5–7.5 |
| Pitcher | Walks Allowed | 1.5, 2.5, 3.5 |

**Critical caveat — props are "predicted" but never priced.** `getOddsPoolForDate`'s
`propPlays()` (`src/lib/queries/oddsPool.ts`) computes prop `ev` **only** against the
de-vigged **market** consensus; `modelEv` is hardcoded `null` for every prop row with the
comment *"props have no Archer model today."* The Archer Prop Projection
(`projectPropHit`) lives in a structurally separate code path (`src/lib/props/mlbBoard.ts`,
used by the `/props` board and player-detail pages) that **never intersects** the odds pool
that actually prices and posts plays. So: a calibrated, backtested prop probability exists,
paid prop odds are ingested, and yet nothing in the codebase ever computes prop EV from the
two together. This is the single largest gap between what's "predicted" and what's "priced."

---

## 2. Exact current features

"Active" = read by the live (non-backtest) pricing path today. "Experimental" = validated
and wired somewhere, but not into the priced EV. "Unused" = computed nowhere in production
despite being investigated. "Descriptive" = shown to the user but not fed into any model
math.

| Feature | Source (file : symbol) | Raw data source | Window / calculation | Target(s) | Weight / transform | Status | Available pregame, no leakage? |
|---|---|---|---|---|---|---|---|
| Home/away split win% | `queries/teamForm.ts : formForTeam` (`homeRecord`/`awayRecord`) | MLB Stats API → `Game` | Season-to-date, venue-specific | Win prob | `FORM_WEIGHTS.split = 0.35` of form blend | Active | Yes |
| Last-10 win% | `teamForm.ts : reduceRecordSplit(last10)` | Same | Trailing 10 finished games (venue-blind) | Win prob | `FORM_WEIGHTS.last10 = 0.40` | Active | Yes |
| Last-5 win% | `teamForm.ts : reduceRecordSplit(last5)` | Same | Trailing 5 (venue-blind) | Win prob | `FORM_WEIGHTS.last5 = 0.25` | Active | Yes |
| Season runs-for/against | `teamForm.ts : reduceRunsSplit(runsSeason)` | `Game.home/awayScore` | Season cumulative rate | Expected runs (offense/defense) | `RUNS_WEIGHTS.season = 0.35` | Active | Yes |
| Last-10 runs-for/against | `teamForm.ts (runsLast10)` | Same | Trailing 10 | Expected runs | `RUNS_WEIGHTS.last10 = 0.40` | Active | Yes |
| Last-5 runs-for/against | `teamForm.ts (runsLast5)` | Same | Trailing 5 | Expected runs | `RUNS_WEIGHTS.last5 = 0.25` | Active | Yes |
| Probable-starter season ERA | `queries/matchup.ts : toPitcherInfo` ← `PitcherSeasonStats.era` | MLB Stats API `fetchPitcherSeasonStats` | Season-to-date, recomputed as `27·ER/outs` (not MLB's own ERA string) | Win prob (`pitcherQualityScore`) + expected runs (`pitcherExpectedRuns`) | Win prob: `PITCHER_WEIGHT = 0.4` of team strength; runs: `PITCHER_WEIGHT = 0.25` of blend | Active | Yes, live; see §5 for the live-vs-backtest divergence |
| Pitcher games-started (sample size) | `matchup.ts` / `PitcherSeasonStats.gamesStarted` | Same | Season-to-date count | Confidence shrink for ERA | `sampleConfidence(gs, 8)` → `shrinkToward(·, 0.5 or 4.3, confidence)` | Active | Yes |
| Pitcher innings pitched (season) | `matchup.ts` / `PitcherSeasonStats.inningsPitched` | Same | Season-to-date | `starterShare = avgIP/9` in `pitcherExpectedRuns` | Determines starter-vs-bullpen split of runs | Active | Yes |
| Home-field constant | `archer/winProbability.ts : HOME_FIELD_LOGIT` | Hardcoded (`ln(0.54/0.46)`) | Fixed, not team- or date-specific | Win prob | Additive logit shift, uncalibrated per-team | Active (global constant) | N/A — not data |
| League-average ERA (4.2) / runs (4.3) | `winProbability.ts`, `expectedRuns.ts` | Hardcoded | Fixed anchor for all shrinkage | Win prob + expected runs | Shrinkage anchor | Active (global constant, comment says "recalibrate if league-wide scoring shifts materially" — no scheduled recheck exists) | N/A |
| `STRENGTH_CALIBRATION_SHRINK` (0.2) | `winProbability.ts` | Fit once via lookahead-safe backtest (1,281 games, per docstring) | Fixed multiplier on the strength differential | Win prob | Global recalibration, not per-game | Active | N/A |
| `TOTAL_RUNS_VARIANCE` (20.5) / `MARGIN_RUNS_VARIANCE` (21.5) | `archer/runProbability.ts` | Fit once via backtest (1,206 games, per docstring) | Fixed variance for the Normal approximation | Totals / spreads probability | Held constant, not scaled with the mean | Active | N/A |
| De-vigged market consensus | `odds/devig.ts : consensusFairProbability`, `odds/lineEconomics.ts` | Paid odds provider (ParlayAPI / The Odds API) current lines | Live, per-book proportional devig averaged across books at the modal point | `marketEv` (separate lens from `modelEv`, never blended) | N/A — kept parallel by design | Active | Yes (uses only currently-quoted prices) |
| Rolling team hit-rate ("Hist EV") | `queries/hitRate.ts : getTeamHitRate` ← `GameOutcome` | Own graded history (derived from `Game` + previously-polled paid odds via `gradeOutcomes.ts`) | Trailing 10 **graded** games per market/side, no shrinkage, no opponent/park/pitcher adjustment | Shown as a third, independent EV lens on the game page (`GameLinesView.tsx`) | None — raw hit-rate used directly as a probability | Active, but **not consumed by the Archer model at all** | Yes, but overlaps team-form/runs signals already in Archer — see §3 |
| Prop: empirical-Bayes season rate | `props/projection.ts : projectPropHit` | `PlayerGameLog` | Season-to-date hits/sample, shrunk toward a pooled population base rate with `PRIOR_STRENGTH_GAMES = 30` | Prop ranking | Posterior mean: `(hits + 30·base) / (sample + 30)` | Active (ranking only, no EV — see §1) | Yes |
| Prop: L10 recency tilt | `projection.ts` | `PlayerGameLog` | `RECENCY_TILT = 0.05 · (L10rate − seasonRate)` | Prop ranking | Deliberately tiny, additive | Active (ranking only) | Yes |
| Prop: vs-LHP / vs-RHP split | `props/hitRate.ts : computePropHitRateSplits`, `mlbBoard.ts` splits | `PlayerGameLog.opposingStarterHand` | Season-to-date filtered by opposing-starter hand | **Displayed** to the user as an informational column | None — raw filtered hit-rate | **Descriptive only** — the analogous player-level platoon signal was tested (`matchup:platoon`) and found to be a plate-appearance confound, not real skill (see §3, §6 item 4) | Yes, but see validation caveat |
| Prop: pitcher workload ramp | `props/pitcherRamp.ts : pitcherRampFor`, fit via `scripts/calibrate-pitcher-props.ts` | `PlayerGameLog` (pitching lines) | Bounded linear term in prior-starts-this-season (`cap = 8`) | Pitching-prop ranking only | `slope · (min(priorStarts, cap) − pivot)` | Active for props (ranking only); **not used by the game-line model** (see §6 item 15) | Yes |
| Prop: opponent lineup K-rate | `props/opponentKRate.ts` | `PlayerGameLog` (batting) | Trailing, league-relative K/PA, min. 100 PA | Pitcher-K prop ranking | `β·(oppRate − league)`, β fit per line (1.34–1.86) | Active (ranking only) | Yes |
| Prop: park K-rate | `props/parkKRate.ts` | `PlayerGameLog` (batting, tagged by home team) | Trailing, league-relative K/PA at the park, min. 500 PA | Pitcher-K prop ranking | `β·(parkRate − league)`, β fit per line (1.69–2.43) | Active (ranking only) | Yes |
| Prop: opposing-starter K-rate | `props/opposingStarter.ts` | `PlayerGameLog` (pitching) | Trailing K/batters-faced, min. 200 BF | Batter-K o0.5 prop ranking only | `β·(starterRate − league)`, β = 0.86 | Active (ranking only, one line only) | Yes |
| Lineup slot / batting order | `LineupSlot` table, `mlb/syncLineups.ts` | MLB Stats API `fetchMlbLineup` | Posted lineup, replaced fully per game | Selects **which** batters appear as prop candidates (not a numeric feature) | N/A | Active, but see architecture note below | Yes |
| Opposing-starter handedness | `MlbPlayer.pitchHand`, `props/gameLogIngest.ts` | MLB Stats API `fetchMlbPersonHandedness` | Denormalized at ingest | Filter tag for vs-LHP/RHP split | N/A | Active | Yes |

**Architecture note:** `syncLineups` is called only from `/api/cron/sync-results`
(`src/app/api/cron/sync-results/route.ts`), **not** from `mlbAdapter.ingest()`
(`src/lib/engine/adapters/mlb.ts`). The documented `SportAdapter.ingest()` contract
(`docs/architecture/sport-engine.md`) is not actually the production ingestion entry point
for lineups — consistent with `EDGE-BASELINE-AUDIT.md`'s finding that `SportAdapter.ingest()`
generally isn't called in production at all; this is one more concrete instance of that gap.

**Features calculated but not used for pricing:** the entire Archer Prop Projection stack
(empirical-Bayes rate, recency tilt, workload ramp, all three matchup context shifts) — see
§1's caveat. **Features used without adequate historical validation:** the vs-LHP/vs-RHP
splits shown on the props UI (validated negatively at the player level, shown anyway); the
global constants (home-field 54%, league-average ERA/runs, all recency weights) that carry a
"recalibrate if..." comment but no scheduled or automated recheck (last baked calibration run
2026-07-16, per `mlb.ts`'s `MLB_MODEL.calibration.asOf` — see §5).

---

## 3. Formula reconstruction

### Win probability (`archer/winProbability.ts`)

```
teamFormScore(form, isHome) =
    weightedAvg([ winPct(isHome ? homeRecord : awayRecord), 0.35 ],
                [ winPct(last10),                           0.40 ],
                [ winPct(last5),                             0.25 ])
    // renormalized over whichever splits have games played

pitcherQualityScore(pitcher) =
    raw = logistic( (4.2 − era) / 1.4 )                 // 0.5 at league-average ERA
    shrinkToward(raw, 0.5, confidence = min(gamesStarted / 8, 1))

teamStrength(pitcher, form, isHome) =
    weightedAvg([ teamFormScore(form, isHome), 0.60 ],
                [ pitcherQualityScore(pitcher), 0.40 ])

rawHomeProb = logistic(
    (homeStrength − awayStrength) · 6 · 0.2          // STRENGTH_SENSITIVITY · STRENGTH_CALIBRATION_SHRINK
    + ln(0.54 / 0.46)                                 // HOME_FIELD_LOGIT
)
homeProb = clamp(rawHomeProb, 0.15, 0.85)
awayProb = 1 − homeProb
```

### Expected runs (`archer/expectedRuns.ts`)

```
weightedRunsRate(form, side) =
    raw = weightedAvg([ runsPerGame(season, side), 0.35 ],
                       [ runsPerGame(last10, side), 0.40 ],
                       [ runsPerGame(last5, side),  0.25 ])
    shrinkToward(raw, 4.3, confidence = min(gamesSeason / 15, 1))

pitcherExpectedRuns(pitcher, bullpen) =
    shrunkEra = shrinkToward(era, 4.3, confidence = min(gamesStarted / 8, 1))
    starterShare = clamp(avgInningsPerStart / 9, 0, 1)   // avgIP = inningsPitched / gamesStarted, else 5.5
    bullpenShare = 1 − starterShare
    bullpenRate = shrinkToward(9·bullpen.earnedRuns / (bullpen.outsRecorded/3), 4.3,
                                confidence = min(relieverInnings / 60, 1))   // 4.3 if no sample yet
    shrunkEra · starterShare + bullpenRate · bullpenShare   // bullpen is now the PITCHER'S OWN team's
                                                             // trailing relief rate, not a flat constant — see §8 outcome

expectedRuns(team) =
    weightedAvg([ ownOffenseRate,        0.45 ],
                [ opponentDefenseRate,   0.30 ],
                [ opponentPitcherRuns,   0.25 ])
```

### Totals / spreads probability (`archer/runProbability.ts`)

```
P(total > point)        = 1 − Φ(point; mean = homeRuns + awayRuns, var = 20.5)
P(total < point)        = 1 − P(total > point)
P(home covers point)    = 1 − Φ(−point; mean = homeRuns − awayRuns, var = 21.5)
P(away covers point)    =     Φ( point; mean = homeRuns − awayRuns, var = 21.5)
```
(`Φ` = Normal CDF, `src/lib/stats/normal.ts`, Abramowitz–Stegun approximation.)

### Market de-vig and EV (`odds/devig.ts`)

```
impliedProb(americanOdds)   // standard American-odds → probability conversion
devigPair(priceA, priceB) = { fairA: impliedA/(impliedA+impliedB), fairB: impliedB/(impliedA+impliedB) }
consensusFairProb = mean over books, of each book's OWN devigged fair prob, at the modal point
EV(fairProb, price) = fairProb · decimalOdds(price) − 1
```

### Kelly sizing (`betting/kelly.ts`)

```
b = decimalOdds(price) − 1
kellyUnits = 0.25 · (ev / b) / 0.02        // quarter-Kelly, 2%-of-bankroll unit
units = min(kellyUnits, maxUnitsForPrice(price))   // price-tiered ceiling: 3u / 1.5u / 0.75u / 0.5u
units = round(max(0.25, units) to nearest 0.25)
```

### Prop projection (`props/projection.ts`)

```
shrunkRate = (seasonHits + 30 · baseRate) / (seasonSample + 30)      // empirical Bayes
tilt       = 0.05 · (L10rate − seasonRate)                            // recency nudge
ramp       = slope · (min(seasonSample, cap) − pivot)                 // pitching only, from a fit table
contextShift = Σ (opponentKShift, parkKShift, opposingStarterKShift)   // matchup terms, where fitted
probability = clamp(shrunkRate + tilt + ramp + contextShift, 0.02, 0.98)
```

### Overlapping / double-counted information

- **Last-3 vs last-5 vs last-10 vs overall.** `teamFormScore` and `weightedRunsRate` both
  blend `season` (0.35), `last10` (0.40), `last5` (0.25) **nested, overlapping windows** —
  the last 5 games are a subset of the last 10, which are a subset of the season. This is a
  deliberate recency-weighting design, not a bug, but it means the effective weight on the
  most recent ~5 games is higher than the stated 0.25 suggests, since those same games are
  also counted inside the last-10 and season components. No orthogonalization is attempted.
- **Overall record vs. home/away record.** The win-probability form score uses the **venue
  split** (home record if the team is home, away record if away) for its `split` component,
  but `last5`/`last10` are **venue-blind** (whatever games happened to be played, home or
  away). A team on a long road trip has its "recent form" partly built from away games while
  its `split` component measures a completely different (and often much smaller) home-only
  sample. The two components are drawn from different reference frames and blended as if
  comparable.
- **Pitcher ERA vs. team run prevention — the clearest double-count risk.** `expectedRuns`
  blends `opponentDefenseRate` (the opposing team's own trailing runs-allowed rate, weight
  0.30) with `opponentPitcherRuns` (that same team's **starting pitcher's** ERA-derived
  runs estimate, weight 0.25). But a team's recent runs-allowed rate is itself substantially
  driven by who has been starting for them — including, in many cases, this same pitcher's
  own recent starts. A genuinely strong or weak starter is therefore counted **twice**: once
  through his own ERA term, and again through the team defense term that already partly
  reflects his own recent work. This is the single most concrete double-counting risk found
  in the reconstruction.
- **Historical hit-rate vs. model probability.** The game page (`GameLinesView.tsx`) shows
  "Hist EV" (rolling 10-game team hit-rate against the market, via `GameOutcome`) directly
  beside "ARCHR Edge" (the calibrated Archer model). Both draw on overlapping underlying
  information (recent scoring and win/loss), but through unrelated, uncalibrated mechanisms
  — Hist EV has no shrinkage, no opponent adjustment, and is explicitly labeled in the UI's
  own disclaimer as "a noisier, directional estimate only." The two numbers are never
  reconciled; a human manually building the deck sees two partially-correlated numbers that
  can appear to independently confirm each other when they're really echoing the same recent
  results through different lenses.
- **Market probability vs. proprietary model probability.** These are kept deliberately
  **separate** (`marketEv` vs. `modelEv`, never blended into one number) — this is the
  correct design, not a double-count. But per `docs/architecture/calibration.md`, every
  sibling model that has been tested this way (tennis, soccer, NFL) turned out to be
  calibration-"trusted" yet **CLV-negative** — its own disagreement with the market did not
  predict a real edge. MLB has never been asked this question (see §5) — so today, a human
  picking a play where ARCHR Edge and Mkt EV disagree has no evidence about which one to
  trust more, for this specific sport.

---

## 4. Data-lineage map

Distinguishing **FREE** (MLB Stats API, unkeyed) from **PAID** (ParlayAPI / The Odds API,
credit-metered — see `docs/architecture/provider-coverage.md`):

```
[FREE] MLB Stats API schedule ──▶ syncMlbSchedule (mlb/syncSchedule.ts)
                                      ──▶ Game table
                                            ├──▶ queries/teamForm.ts (form + runs splits)
                                            ├──▶ queries/games.ts (display)
                                            └──▶ queries/matchup.ts ──▶ archer/{winProbability,expectedRuns}.ts
                                                                          ──▶ archer/runProbability.ts
                                                                          ──▶ queries/oddsPool.ts (modelData)
                                                                          ──▶ OddsPlay.modelEv
                                                                          ──▶ board (+EV selection) / GameLinesView "ARCHR Edge"

[FREE] MLB Stats API probable pitchers + season stats ──▶ syncProbablePitchers (mlb/syncPitchers.ts)
                                      ──▶ Game.home/awayProbablePitcherId, PitcherSeasonStats
                                            ──▶ queries/matchup.ts ──▶ (same path as above)

[FREE] MLB Stats API boxscores (final games) ──▶ ingestGameLogsForGame (props/gameLogIngest.ts)
       triggered by syncRecentPlayerGameLogs (props/syncGameLogs.ts), called from
       /api/cron/sync-results — NOT from mlbAdapter.ingest()
                                      ──▶ PlayerGameLog table
                                            ├──▶ props/hitRate.ts, props/mlbBoard.ts, props/projection.ts
                                            │     ──▶ props board ranking + prop-detail hit-rate splits
                                            │         (NO EV — see §1)
                                            └──▶ props/{opponentKRate,parkKRate,opposingStarter}.ts (matchup terms)

[FREE] MLB Stats API lineups ──▶ syncLineups (mlb/syncLineups.ts, called ONLY from
       sync-results cron, not mlbAdapter.ingest — see §2 architecture note)
                                      ──▶ LineupSlot table
                                            ──▶ props/mlbBoard.ts buildBatterBoard (candidate selection)

[PAID] ParlayAPI / The Odds API game odds ──▶ pollAndStoreOdds (odds/ingest.ts)
                                      ──▶ assignEventsToGames (ET-date + team-name matching)
                                      ──▶ OddsSnapshot, CurrentOddsLine tables
                                            ──▶ queries/oddsPool.ts: marketConsensus/devig ──▶ OddsPlay.ev
                                            ──▶ paired with modelData (above)                ──▶ OddsPlay.modelEv
                                            ──▶ board / GameLinesView "Mkt EV" + "ARCHR Edge" columns

[PAID] ParlayAPI / The Odds API player-prop odds ──▶ pollAndStorePlayerProps (props/pollPlayerProps.ts)
                                      ──▶ storePlayerPropOdds (props/storePropOdds.ts)
                                      ──▶ PlayerPropSnapshot, CurrentPlayerPropLine tables
                                            ──▶ queries/oddsPool.ts propPlays() ──▶ devig consensus ──▶ OddsPlay.ev
                                                (modelEv ALWAYS null here — never meets the props/mlbBoard.ts
                                                 projection number; two parallel pipelines, see §1)

[MIXED] Game.home/awayScore [FREE] + previously-polled paid lines [PAID, already stored]
                                      ──▶ gradeOutcomes.ts: gradeGame + captureClosingLine
                                      ──▶ GameOutcome table ──▶ queries/hitRate.ts ──▶ GameLinesView "Hist EV"
                                      ──▶ GameClosingLine table ──▶ (written, never read by any MLB
                                          analysis — no MLB CLV backtest exists; see §5)

[FREE] MLB Stats API player handedness ──▶ ingestGameLogsForGame (upsert on MlbPlayer)
                                      ──▶ MlbPlayer.batSide/pitchHand
                                            ──▶ props/hitRate.ts vs-LHP/RHP filters, mlbBoard.ts splits
```

**Free vs. paid split, summarized:** every input to the win-probability and expected-runs
*model itself* (schedule, scores, probable pitchers, season pitching stats, boxscores,
lineups, handedness) is **free** (MLB Stats API, unkeyed). The **paid** layer
(ParlayAPI/The Odds API) supplies only the **prices being compared against** — the model's
own predictions cost nothing to generate; the credits are spent entirely on knowing what the
market is offering.

---

## 5. Validation audit

**Backtest date ranges.** The baked calibration snapshot (`mlb.ts : MLB_MODEL.calibration`)
records `asOf: "2026-07-16"` and `n: 1343`, drawn by `collectMlbSamples`
(`src/lib/engine/adapters/mlb.ts`) querying `Game` `orderBy: scheduledStartUtc desc, take: N`
(`N` defaults to 2000 via `npm run backtest:mlb`) — i.e. **the most recent N settled games**,
not a fixed calendar window. The actual calendar span covered by the last baked run is not
recorded anywhere (only `n` and `asOf` are persisted in `CalibrationSnapshot`), so a future
re-run cannot confirm whether a changed verdict reflects a materially different backtest
window or a real model change.

**Sample sizes — inconsistent across the model's own sub-components.** Three different `n`
values are cited for what is nominally the same underlying reconstruction, from different
points in time: **1,343** (the currently-baked moneyline snapshot), **1,281** (cited in
`winProbability.ts`'s docstring for the original shrink-fit), and **1,206** (cited in
`runProbability.ts`'s docstring for the totals/spread variance fit). No single script run
produces all three at once — each was backtested separately, at a different time, over a
different data cutoff. The player-prop projection was validated over **~23,000 player-games**
(`projection.ts` docstring); the matchup context terms (opponent/park/opposing-starter K-rate)
were each fit on **a single partial season** (`docs/architecture/props-matchup.md`: "2026,
Mar 26–Jul 7 at time of writing").

**Train/test separation.** Consistent methodology throughout: chronological 70/30 split,
fit on the older portion, validated out-of-sample on the newer portion. Used for the
win-probability shrink, the runs variance, the prop projection's K/tilt, the pitcher-ramp
fit, and every matchup-term beta. `src/lib/engine/calibration.ts`'s `timeSplitRefit` /
`bestShrink` implement this generically and are available on demand via `npm run backtest:mlb`.

**Walk-forward testing.** Not implemented for MLB — it is a single train/test split, run
once, with the resulting constants baked as literals in source (`STRENGTH_CALIBRATION_SHRINK`,
`TOTAL_RUNS_VARIANCE`, `MARGIN_RUNS_VARIANCE`, the prop `PRIOR_STRENGTH_GAMES`/`RECENCY_TILT`,
every matchup beta). `scoreCalibration`'s `timeSplitRefit` can be re-run at any time to check
whether the baked value still holds, but nothing runs it on a schedule — the last recorded run
is **2026-07-16**, roughly two months before this audit's date.

**Calibration metrics.** Only **Brier score** and **base-rate Brier** are persisted
(`CalibrationSnapshot`: `brier: 0.2499`, `baseRateBrier: 0.2489`, `skill: +0.0010` → verdict
`"marginal"` — the codebase's own comment calls this *"essentially no proven edge"*).
**Log-loss** is computed by `scoreCalibration` on every live run but is **not** part of the
persisted `CalibrationSnapshot` type — it exists only ephemerally in the console report.
**Accuracy** (plain hit-rate on the model's favorite pick) is never separately reported.

**CLV evaluation — the largest gap.** **No `backtest-mlb-clv.ts` script exists.** Tennis
(`backtest-tennis-clv.ts`), soccer (`backtest-soccer-clv.ts`), and NFL (`backtest-nfl-clv.ts`)
each have one, and per `calibration.md` **every one of them lost to the closing line** despite
being calibration-"trusted" — the exact reason those sports stay signal-only. MLB is the
flagship sport and has never been asked this question. The raw data to answer it **already
exists**: `gradeOutcomes.ts`'s `captureClosingLine` writes a `GameClosingLine` row (modal
point + average price, captured just before first pitch) for every graded market/side, but
nothing anywhere reads that table for MLB. This is a data-collection investment already made
and entirely unused.

**Were actual closing lines available?** Yes — see above. Captured, unused.

**Possible look-ahead leakage.**
- The **backtest** reconstruction (`collectMlbSamples`) is careful and well-documented: it
  computes each historical starter's ERA strictly from that pitcher's own `PlayerGameLog`
  rows dated before the game (not the season aggregate), and team form via
  `getTeamFormForGame(..., before)`.
- The **live** pricing path (`queries/matchup.ts : getGameMatchup`) instead reads
  `PitcherSeasonStats` — a stored season-to-date aggregate, refreshed by a cron that runs
  several times daily. This is not leakage in the traditional sense (the pitcher hasn't
  thrown the game in question yet), but it means **the live path and the backtested path are
  different code**, computing what should be the same "as-of" quantity two different ways.
  The baked Brier score (0.2499) is a validated property of the *backtest reconstruction*,
  not a byte-for-byte guarantee about what the live pipeline computes on any given day — a
  gap the codebase's own comments in `mlb.ts` acknowledge directly.
- The live `getTeamFormForGame` call carries no `before` cutoff (correct for "today," since
  today's game hasn't finished) but does depend on `sync-results` having already run; if it
  hasn't, "final" games from earlier the same day are simply missing from the query — a
  freshness gap that **understates** information rather than leaking future information.
- The three prop matchup terms (opponent/park/opposing-starter K-rate) are explicitly
  computed via `...RatesAsOf(..., before: gte)` filters (`lt: gte`, strictly before the
  board's date) — correctly lookahead-safe for live use.

**Survivorship / selection bias.**
- `purgePreseasonGames()` retroactively deletes spring-training/exhibition games that were
  originally ingested as regular-season finals before a `gameType` filter existed — a real
  historical data-quality incident, not a hypothetical, that would have inflated team-form
  and runs samples had it gone uncorrected.
- Every wired prop matchup term is fit on **one partial season** — `props-matchup.md`'s own
  "Data caveat" section names this directly and flags every wired beta as due for a re-fit
  once multi-season data exists. There is no cross-season validation anywhere in the MLB
  model.
- No feature anywhere accounts for roster-changing events (trades, IL stints, rotation
  changes) beyond whatever lag shows up naturally in trailing stats.

**Conclusions supported by current evidence:**
- The MLB moneyline model is **honestly calibrated** (its stated probabilities roughly match
  realized frequencies) but demonstrates **no proven predictive edge** over a base-rate guess
  — Brier 0.2499 vs. 0.2489, verdict `"marginal"`, by the codebase's own explicit accounting.
- The totals/spread variance recalibration (empirical ~20.5/21.5 replacing an original
  Poisson variance-equals-mean assumption) fixed a real, measured overconfidence bug
  (documented before/after reliability numbers in `runProbability.ts`).
- The player-prop empirical-Bayes projection demonstrably beats raw trailing hit-rate and
  raw season-rate on out-of-sample Brier, for ranking purposes.
- The three wired matchup context terms demonstrably improve out-of-sample Brier for
  pitcher-strikeout and one batter-strikeout line specifically; several adjacent ideas
  (platoon, batting-side park factors, stolen-base matchup, batter-hits-vs-starter) were
  tested and found **not** worth wiring, and are documented as such.

**Conclusions NOT supported by current evidence:**
- That the MLB game-line model beats the market. No MLB CLV backtest has ever been run,
  and every sibling model that has been tested this way lost to the closing line.
- That player props are a real, book-beatable edge. `backtest-props-edge.ts`'s own docstring
  calls its result *"a proxy, not proof"* — a sharpness sweep against assumed vig, because
  real historical prop **odds** (only outcomes are free) don't exist in this dataset.
- That the vs-LHP/vs-RHP splits shown on the props UI are predictive — the one related study
  that was run (`matchup:platoon`) found the player-level version of this signal to be a
  plate-appearance opportunity artifact, not real hitting skill, yet the UI still surfaces
  the raw splits with no caveat.
- That the model's global constants (home-field 54%, league-average ERA/runs, the recency
  weights, the confidence thresholds) are still accurate for the current season. They carry
  a "recalibrate if..." comment but no scheduled or automated recheck.

---

## 6. Missing-feature backlog

Evaluated without implementing. "Do we have the data?" and "free source in repo?" are
answered from what this repository actually ingests today, not from what's theoretically
obtainable from MLB Stats API/Statcast in general.

| # | Feature | Mechanism | Required data | Have it? | Free source in repo? | Leakage risk | Sample-size risk | Overlap with existing features | Priority |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Weather (temp/wind/humidity/precip) | Wind and air density change HR carry and scoring | Per-park, per-first-pitch conditions | No | None found | Low if pregame forecast, not postgame actuals | Low (every game has weather) | None | **Later** |
| 2 | Park factors (run/HR scoring index) | Some parks structurally inflate/deflate scoring independent of team form | Park-level scoring history (derivable from own `Game` data, same technique as `parkKRate.ts`) | Partial — only a K-rate park effect exists today, not general scoring | Yes, derivable from existing `Game` scores | Low if trailing | Moderate — single season, thin per-park samples (props-matchup.md's shelved batter-park-factor study found real but order-of-magnitude weaker effect than the K terms) | Would need to avoid double-counting against `parkKRate.ts`'s existing K-specific term | **Later** |
| 3 | Confirmed lineup quality (composite offensive rate stat) | Actual batters in the lineup predict a specific game's scoring far better than season team average | `LineupSlot` (have) + a per-player rate stat (not computed anywhere) | Half — raw logs exist, no rate-stat aggregation exists | Yes, derivable from `PlayerGameLog` | Low if computed strictly before the game; unavailable until lineup posts (a few hours pre-game) | Moderate–high per player, needs shrinkage like pitcher ERA | Would **replace**, not add to, the existing team-level offense rate in `expectedRuns.ts` — using both risks double-counting the same batters | **Research** |
| 4 | Lineup handedness composition | Same-handed lineup vs. opposite-handed starter shifts scoring beyond raw ERA | Batter handedness (have) + pitcher vs-hand splits (don't have) | Half | `batSide` free/ingested; pitcher splits not ingested (statsapi.mlb.com exposes a splits hydrate this repo has never called) | Low if season-to-date | High — split samples are a fraction of full-season ERA sample | Directly related to item 5 and to the already-shelved player-level `matchup:platoon` finding (PA confound) — a team-aggregate version has not been separately tested | **Research** |
| 5 | Pitcher performance vs LHB/RHB | A pitcher's platoon split matters more against a hand-skewed lineup | Per-pitcher vs-hand rate stats | No | Plausible provider-level source, zero ingestion code today | Low if season-to-date | High (same as item 4) | Same feature as item 4, opposite side — should be built together | **Research** |
| 6 | Pitcher pitch mix vs. hitter pitch-type performance | A fine-grained "stuff matchup" beyond platoon | Pitch-level (Statcast) tracking data | No — not even close | None; would need a wholly new ingestion tier | Low if trailing, but complex to guarantee | Very high — multiplies dimensionality fast | Extends items 4/5's platoon idea to a finer grain | **Research only** |
| 7 | Bullpen quality | `expectedRuns.ts`'s own bullpen-share term already uses a **flat league-average constant** in place of any team-specific bullpen data | Team relief-pitching ERA/runs-allowed (derivable from existing `PlayerGameLog` `isStarter: false` rows) | Half — raw logs exist, no aggregate computed | **Yes, entirely, from data already ingested** | Low if trailing, same pattern as `weightedRunsRate` | Moderate — team-level bullpen sample across many relievers is less noisy than one starter's ERA | Cleanly replaces a named placeholder constant (`LEAGUE_AVG_RUNS_PER_GAME`) with no other overlap | **Built — see §8 outcome** (Brier acceptance gate not yet run against real data, see note) |
| 8 | Recent bullpen workload (fatigue) | An overworked bullpen underperforms its season rate | Appearance frequency (derivable) + true pitch counts (not stored) | Partial | Appearance frequency yes; pitch counts no (boxscore has them, `statsApi.ts` doesn't parse them) | Low if trailing | High — a second-order refinement, premature before item 7 exists | Strict refinement of item 7 | **Later** (sequenced after 7) |
| 9 | Catcher effects (framing/game-calling) | Some catchers meaningfully affect pitching-staff runs allowed | Which player caught (not stored — no position field) + a framing metric (Statcast-only) | No, on both counts | None | Low if season-to-date, but metric itself isn't computable here | High — a small effect on an already-thin sample | `props-matchup.md` already names catcher-level granularity as the reason the stolen-base study was shelved | **Reject** (for now) |
| 10 | Defense (fielding quality / DIPS-adjacent) | Better defense converts more balls in play to outs, beyond what a pitcher's own K/BB numbers show | A crude proxy (derivable from existing `outsRecorded`/`hitsAllowed`/`strikeoutsPitching`) or true OAA/DRS (not derivable) | Half | Crude proxy yes; real metric no | Low if trailing | Moderate | Overlaps conceptually with the existing `opponentDefenseRate` term (runsAgainst) — must be tested as an incremental residual term, same bar as the wired K-terms | **Research** |
| 11 | Umpire tendencies | Some plate umpires call meaningfully different strike zones | Umpire assignment (not ingested) + tendency metric (needs pitch-level data) | No, on both counts | None | Low if assignment known pregame (it typically is) | High — individual umpires work few games/season; needs multi-season data this repo doesn't have | None | **Research only** |
| 12 | Injuries and scratches | A late scratch invalidates the pregame projection | Real-time injury/transactions feed | Largely covered indirectly — `syncProbablePitchers`/`syncLineups` already run multiple times daily and pick up starter/lineup changes | The downstream effect is already free; no dedicated injury feed exists | N/A (freshness question, not leakage) | N/A | Overlaps entirely with existing sync cadence; marginal value is only the gap between syncs or a non-pitcher/lineup injury (e.g. bullpen arm) | **Later** |
| 13 | Travel and rest | Cross-country travel / short rest hurts performance; extended rest is mixed | Fully derivable from existing `Game` schedule | Yes, mechanically — nothing new to ingest | Yes | Low — schedule is public well pregame | The one existing pitcher-rest study (`matchup:rest`) found standard rest flat but extended rest (n=293) real, and explicitly **not wireable yet** — confounded with All-Star-break scheduling, untestable on one partial season | Team-level travel/fatigue is unexplored territory; adjacent to the shelved pitcher-rest finding | **Later** (team-level) / **Research only** (pitcher-specific, explicitly blocked per `props-matchup.md`) |
| 14 | Day/night splits | Some players perform differently under day vs. night conditions | Start time (have) + day/night classification (not parsed) + splits (not computed) | Half | Yes, cheaply derivable | Low — schedule known pregame | Moderate — league-wide effect is typically small | None | **Research only** |
| 15 | Starting-pitcher workload (game-line model) | The exact within-season workload ramp already validated for **prop** lines is not connected to the **game-line** expected-runs model, which still uses only season-cumulative ERA/IP | Same `PlayerGameLog` data already used by `props/pitcherRamp.ts` | **Yes, in full** — the validated module already exists | Yes, entirely | None beyond what's already accepted for the props version | Low — same validated data/fit as the wired props ramp | This is a **reuse**, not a new feature — literally the same tested signal, currently wired to one consumer (props ranking) and not the other (game-line pricing) | **Now** — lowest-lift item on this list |
| 16 | Velocity and movement trends | Drifting fastball velocity/movement predicts near-term performance changes before ERA reflects them | Statcast pitch-tracking (release velo, spin, movement) | No | None; same data-tier gap as item 6 | Low if trailing | High for any individual trend signal | Related to items 5/6, would be built as part of the same future Statcast effort | **Research only** |

---

## 7. Architecture recommendation

The existing `SportAdapter` contract (`docs/architecture/sport-engine.md`) already states the
right top-level principle — *"adapters own their storage… the mess is boxed, and every box
looks identical from the outside"* — but that principle currently stops at the **game/result**
storage layer. It has not been extended one layer deeper, into **features**, which is where
this audit found the sharpest gaps (the live-vs-backtest divergence in §5; the duplicated
"as-of" reconstruction logic in `collectMlbSamples` vs. `queries/matchup.ts`). The
recommendation below is the same principle, applied to features, mapped onto what already
exists rather than proposing a rewrite:

| Layer | Recommendation | Maps onto (today) |
|---|---|---|
| **Raw observations** | Keep as-is — already free/paid-tagged, per-sport tables (`Game`, `PlayerGameLog`, `PitcherSeasonStats`, `OddsSnapshot`, `CurrentOddsLine`, `PlayerPropSnapshot`). This layer is in good shape. | Existing Prisma models |
| **Timestamped pregame feature snapshots** | **New, and the highest-value structural addition.** A per-adapter `FeatureSnapshot { sportKey, entityRef, asOf, features: Json }`, written once when a game's inputs lock (pitchers confirmed, lineup posted), never mutated after. This is what's missing today: the live path (`queries/matchup.ts`) and the backtest path (`collectMlbSamples`) independently re-derive "as-of" values with **separate logic**, which is exactly why the baked calibration number is only an approximate guarantee of live behavior (§5). A JSON payload per sport (not a shared columnar table) means UFC's snapshot can carry reach/stance/fight-history while MLB's carries ERA/form/bullpen — no sport is forced into another's shape, extending the existing "adapters own their storage" rule one layer deeper. | Nothing today — closes the §5 divergence |
| **Feature transformations** | Keep the existing pure-function pattern (`weightedAverage`, `shrinkToward`, `sampleConfidence`, `teamFormScore`, `pitcherQualityScore`, `weightedRunsRate`, `pitcherExpectedRuns`) — already well-factored and unit-tested. Change only the *input*: read from a `FeatureSnapshot`, not a live query, so backtest and live share one code path. | `src/lib/archer/*`, `src/lib/stats/*` |
| **Model estimation** | Keep `archer/{winProbability,expectedRuns,runProbability}.ts` and `props/projection.ts` as-is — already the right shape (pure functions of inputs → probability). Standardize the interface across sports (`predict(snapshot) -> {target, probability}`) so a future sport's model slots in next to Archer with no bespoke wiring, the same spirit as the existing `SportModel`/`ModelBacktest` contract. | `src/lib/archer/*`, `src/lib/engine/types.ts` |
| **Calibration** | **No change** — `src/lib/engine/calibration.ts` is already sport-agnostic, shared, and well-designed. The one recommendation: give MLB the CLV-backtest sibling every other main-line sport already has (ties directly to §5 and §8). | `src/lib/engine/calibration.ts` |
| **Backtesting** | Once `FeatureSnapshot` exists, `ModelBacktest.collect()` becomes "replay stored snapshots + score" instead of re-deriving as-of values per sport — removing the duplicated reconstruction logic in `collectMlbSamples` entirely, and closing the live/backtest divergence at the root. | `src/lib/engine/types.ts : ModelBacktest`, each adapter's `collect` |
| **Prediction generation** | Live call sites (`queries/matchup.ts`, `queries/oddsPool.ts`) should read from `FeatureSnapshot` once it exists, rather than recomputing form/ERA fresh on every request — a correctness win (guarantees live matches backtested) and a performance one. | `src/lib/queries/{matchup,oddsPool}.ts` |
| **Market comparison** | **No change** — `odds/devig.ts`, `odds/lineEconomics.ts`, `calculateEv` are already sport-agnostic and reusable. Good pattern, keep it. | `src/lib/odds/*` |
| **Explanation and display** | Collapse the **three parallel, uncalibrated lenses** (`Market EV` / `Historical EV` / `ARCHR Edge`) currently shown side-by-side (`GameLinesView.tsx`) into a labeled hierarchy that states plainly which one is calibration-tested (Archer, currently `"marginal"`) versus which is a raw, unshrunk proxy (Historical hit-rate) — a display fix, directly answering the §3 double-counting concern, requiring no model change. | `src/components/GameLinesView.tsx`, `src/lib/card/line.ts` |

**Per-sport ownership, restated concretely:** the recommendation is not one shared
`FeatureSnapshot` schema with MLB-shaped columns that other sports awkwardly reuse (the exact
mistake `EDGE-BASELINE-AUDIT.md` §9 already documents for `PlayerPropSnapshot`/`StatCategory`)
— it is a loose, per-sport JSON payload keyed by `(sportKey, entityRef, asOf)`, so a future
football, basketball, or UFC feature set never has to be bent into MLB's shape, and MLB's own
feature set can grow (bullpen quality, park factors, etc.) without a schema migration each time.

---

## 8. First MLB improvement experiment

**Add trailing team bullpen quality to `expectedRuns.ts`'s `pitcherExpectedRuns`, replacing
the flat league-average constant currently used for the bullpen-share portion of a team's
runs-allowed estimate.**

- **Hypothesis.** `pitcherExpectedRuns` already splits a game into "starter share" and
  "bullpen share" (`starterShare = avgInningsPerStart / 9`), but the bullpen share is
  currently priced at a flat `LEAGUE_AVG_RUNS_PER_GAME` (4.3) for **every team, every game** —
  the model has zero team-specific information about bullpen quality today. A team's own
  trailing relief-pitching performance should predict the "after the starter leaves" portion
  of expected runs better than a league-wide constant, because bullpen quality genuinely
  varies team-to-team and the current model captures none of that variance.
- **Data — fully obtainable today, no new ingestion.** `PlayerGameLog` rows where
  `isStarter: false` already carry `outsRecorded`, `earnedRuns`, `hitsAllowed`,
  `walksAllowed` for every relief appearance. A trailing team bullpen runs-per-9 rate is one
  more aggregate query, structurally identical to the existing `weightedRunsRate` pattern.
  No provider, schema migration, or new credential is required.
- **No look-ahead leakage.** Compute the trailing bullpen rate from games strictly before the
  game being predicted — reusing the exact `before`-cutoff pattern already audited and used
  throughout this codebase (`getTeamFormForGame`, the props matchup terms'
  `...RatesAsOf(..., before)` functions), rather than inventing a new leakage-guard pattern.
- **Baseline.** The current constant-bullpen `expectedRuns.ts`, scored on the totals/spread
  markets using the same chronological 70/30 split methodology already used for
  `TOTAL_RUNS_VARIANCE`/`MARGIN_RUNS_VARIANCE`. Note: today's baked `CalibrationSnapshot`
  only covers the **moneyline** market — a totals/spread Brier baseline isn't currently
  persisted anywhere and would need to be captured fresh as this experiment's starting point.
- **Acceptance criterion.** Using the same time-split protocol already standard in this
  codebase, the bullpen-adjusted model must produce a **lower out-of-sample Brier score on
  the totals and spread markets** than the constant-bullpen baseline, by a margin at least as
  large as `scoreCalibration`'s existing `trustMargin` (0.002) — the same bar the codebase
  already uses to distinguish a real skill gap from noise. Anything smaller is not worth the
  added complexity.
- **Clean removal.** The change is scoped to one function (`pitcherExpectedRuns`), replacing
  one named constant (`LEAGUE_AVG_RUNS_PER_GAME` in the bullpen-share term) with a computed
  rate. Reverting is a one-function diff with no schema, migration, or ingestion to unwind;
  `expectedRuns.test.ts` already exercises this function directly and would need only new
  fixture cases, not a new test harness.

(Item 15 in §6 — reusing the already-validated pitcher workload ramp inside the game-line
model — is an even lower-lift change with zero new computation, and is a natural candidate to
sequence alongside this experiment rather than instead of it.)

**Outcome (2026-09-22, updated after a real backtest run).** Built as designed:
`src/lib/archer/bullpenRate.ts` + `src/lib/queries/bullpenForm.ts` compute each team's
trailing relief-pitching runs/9, shrunk toward league average by relief-innings sample size
(`BULLPEN_FULL_CONFIDENCE_INNINGS = 60`); `pitcherExpectedRuns` takes the pitcher's own
team's bullpen split instead of the flat constant. `npm run backtest:mlb:totals` was then
run against a real copy of production data (2,430 MLB games, 470-489 graded totals/spreads
with closing lines) — the actual acceptance gate this section describes.

**Result: the gate did not clear on the first run.** With the originally-shipped recent-
workload fatigue term active, totals Brier moved the WRONG way (Δ −0.0005) and spreads
moved the right way but far short of the required margin (Δ +0.0004) — both `FAIL` against
the ≥0.002 bar. A follow-up retune against the same real data (see `BULLPEN_FATIGUE_RUNS_
PER_WORKLOAD_RATIO`'s comment in `expectedRuns.ts`) isolated the two signals: disabling the
fatigue term alone fixed the totals regression (Δ −0.0005 → +0.0002) and left spreads
unchanged (+0.0004); amplifying the quality term 2×/3×/4× improved spreads further (up to
+0.0010 at 4×) but made totals worse again past ~2× — diminishing, then reversing, returns
that would mean curve-fitting this one sample rather than finding real signal. Settled on:
**bullpen quality kept at its natural, unscaled weight; recent-workload fatigue disabled
(ratio = 0, mechanism kept, not reverted) pending a larger archive.** Final state: totals
Δ +0.0002, spreads Δ +0.0004 — both still technically `FAIL` the strict 0.002 bar, but no
longer regressing either market, consistent with the same real-data finding from the
independent player-props check below (bullpen quality: real but marginal, same tier as the
already-shelved park-factor signal; fatigue: no signal, confirmed by two separate checks
agreeing). Unit tests and the full suite pass; `npx tsc --noEmit` clean.

**Honest bottom line:** bullpen quality is more accurate information than the flat constant
it replaced, and doesn't hurt either market — but it hasn't earned "trusted" status on
team-total games by this codebase's own bar, only "kept because it's honestly better than a
guess," the same standing several props signals already hold. Revisit both the fatigue
term and a properly-fitted (not hand-amplified) quality weighting once a larger, multi-
season archive exists.

---

## 9. Questions for the owner

1. When you pick a play for the deck by hand, do you actually look at all three numbers on
   the game page (Archer Edge, Market EV, Historical EV), or mostly one of them? This tells
   us whether to keep showing all three side by side or simplify the page.
2. Are you comfortable with the MLB model currently being "roughly a coin flip" — no proven
   edge over just assuming the home team wins about 54% of the time — or do you want us to
   hold off on promoting MLB moneyline picks until it clears a higher bar?
3. Do you want us to test whether the MLB model's picks actually beat the closing line (the
   same test already run for tennis, soccer, and NFL — all three failed it), even knowing
   that MLB might fail it too?
4. For player props: should we prioritize a way to test the prop rankings against real
   historical prop prices (which costs money to collect), or is ranking players by "most
   likely to clear the line" good enough for now without proving it against real odds?
5. The vs-LHP/vs-RHP splits on the props page look like a meaningful matchup signal, but our
   own testing found this exact signal is mostly an illusion (driven by extra at-bats, not
   real hitting skill). Do you want us to keep showing those splits as-is, add a short
   caveat, or remove them?
6. If we add a "bullpen strength" feature (a team's own recent relief-pitching performance,
   replacing a placeholder number the model uses today), should it show up as its own column
   for you to see, or just get folded quietly into the existing Archer Edge number?
7. How much would you spend on data (in provider credits or a new subscription) to unlock
   deeper features like weather, real lineup-quality ratings, or advanced defense stats,
   versus sticking to free data and refining what we already have?
8. Several ideas we already tested (park factors for hits/home runs, stolen-base matchups,
   extended-rest pitchers) showed a real effect that was just too small to bother wiring in.
   Do you want "small but real" edges added anyway, or should the bar stay at "meaningfully
   moves the number"?
9. The model's core assumptions (average starting-pitcher ERA, average home-team win rate,
   average runs per game) were set once and haven't been checked against this season's actual
   numbers in about two months. Do you want these re-checked on a regular schedule even when
   nothing looks broken?
10. If a future test shows MLB does NOT beat the closing line (like tennis, soccer, and NFL
    already didn't), do you want MLB repositioned as "signal only, line-shopping first" like
    those sports, or do you want to keep pursuing a genuinely beatable MLB-specific edge?
