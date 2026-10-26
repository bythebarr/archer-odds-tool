# The ARCHR model framework

Every player-prop model, in every sport, is built the same way. NBA and NFL
props run on it today (`src/lib/propModel/`). This is the checklist the next
sport follows: MLB batter props, NHL, soccer, tennis, and UFC.

## The pipeline

```
 data            projection (sport-specific)        shared pipeline (propModel/price.ts)
 ────            ───────────────────────────        ───────────────────────────────────
 game logs ──┐
 schedule    ├─► volume × rate × matchup × env ─► distribution ─► calibrate ─► injury ─► blend w/ market ─► EV
 injuries    │   (+ teammates out, season mix)    (count/normal/   (logit       (out →    (weight fitted
 game lines ─┘                                     atLeastOne)      shrink)      withheld) per stat)
```

A sport writes only the projection. The distribution, calibration, injury
rules, market blend and EV are shared, and so is every UI piece explaining
them (`components/props/ModelPieces.tsx`).

## Layers, and what each sport must supply

| # | Layer | Shared module | The sport supplies |
|---|---|---|---|
| 1 | **Game logs** (two seasons, lookahead-safe) | — | A log table, a backfill job, and a `*LogPoint` with `date`, `season`, `isHome`, `opponent` |
| 2 | **Stat catalog** | — | `*PropStats`: key, label, how to read it off a log, its distribution shape, and provider market keys (an allowlist) |
| 3 | **Volume** (minutes, snaps, PAs, TOI, innings) | — | Recency-weighted volume. This is the base every counting stat scales from |
| 4 | **Rate** per unit of volume | `seasonMix` | Recency-weighted rate, shrunk toward the two-season rate. Report the per-game weights so the panel can show this season vs last |
| 5 | **Matchup** | — | What the opponent allows to the player's position, half-regressed and capped |
| 6 | **Game environment** | `environment.ts` (`GameLines`, implied totals, `elasticFactor`) | Per-stat elasticities to the total/implied total, plus the sport's script effect (blowouts, pass/run, pulled goalie, bullpen) |
| 7 | **Teammates out** | `injuries/absence.ts` | Who counts as rotation, and which volume/rate the without-games blend into |
| 8 | **Distribution** | `distribution.ts` | Which shape each stat takes and its spread (the player's own game-to-game variance, never tighter than Poisson) |
| 9 | **Calibration** | `shrinkLogit` | A `*_CALIBRATION_SHRINK` constant, refit by the sport's backtest |
| 10 | **Injury** | `price.ts` (`modelWithheld`, `injuryShrink`) | Nothing: the ESPN injury feed covers NBA/NFL. A new sport adds its own feed |
| 11 | **Market blend** | `market.ts`, `fit.ts` | Prop snapshots stored per poll, so `backtest:props-market` can fit the weight |
| 12 | **Report card** | `engine/saveReport.ts` | A backtest script saving `<sport>-props:<stat>` and `market-blend:<sport>:<stat>` |

### Rules every model keeps

- **No lookahead.** Every backtest projects a game only from games before it.
- **Shrink, cap and regress** every adjustment. A noisy factor that's 50%
  right but capped does little harm; an uncapped one does a lot.
- **Market first.** The model moves the market's number, it doesn't replace
  it. The fitted weight is the honest measure of what the model adds. A weight
  of 0.1 is fine if it's real.
- **Every constant has a backtest.** Priors (like the game-environment
  elasticities) ship regressed and capped. The backtest prints error with and
  without them, and they're refit once the history is there.
- **Explain every number.** The sheet shows model vs market vs blend, this
  season vs last, what the game lines did, and who's out.

## Adding a sport, in order

1. Logs + backfill workflow input (`backfill-history.yml`).
2. Stat catalog + prop ingest (The Odds API market keys) + `Current*PropLine` / `*PropSnapshot` tables.
3. `projection.ts` returning `{ mean, distribution, seasons, env, absence }`.
4. `propsMath.ts` → `summarize*Prop` calling `priceProp`.
5. `slateContext.ts` building the projection context from the slate.
6. Finder UI from the shared pieces (`HitMeter`, `SplitGrid`, `GameLogChart`, `ModelPieces`).
7. `backtest-<sport>-props.ts`, plus the sport's branch in `backtest-props-market.ts`, both added to Model lab's `report:all`.

## Game lines (NBA, NFL): `src/lib/gameModel/`

The same spine for moneyline, spread and total:

1. **Ratings** (`ratings.ts`): opponent-adjusted offense and defense in points,
   updated after every game (a points-based Elo), reverted between seasons. The
   league average and home edge are learned as it goes. Margin and total come
   out of one model.
2. **Adjustments** (`adjust.ts`): rest (NBA back-to-back about −1.25
   ([inpredictable](https://www.inpredictable.com/2012/02/nba-home-court-advantage-and-rest.html));
   NFL bye +0.75, short week −0.5), and who's out. An NBA player's impact is
   his box production above replacement in the same minutes. An NFL starting
   QB is worth 4.5 points, and other high-usage skill players a little.
3. **Distribution** (`scoreDist.ts`): margin and total as whole-point
   distributions. NBA ties go to overtime (spread to ±1–5). NFL margins are
   reweighted to their key numbers: 3 ≈ 15%, 7 ≈ 9%, 10 ≈ 6%
   ([deucescracked](https://www.deucescracked.com/blog/nfl-margin-of-victory-data-1999-2025),
   [docsports](https://www.docsports.com/2026/study-of-nfl-games-reveals-shifting-key-betting-numbers.html)).
   That's why −2.5 and −3.5 are priced so differently.
4. **Pricing** (`price.ts`, `quotes.ts`): each market at the consensus number,
   blended with the no-vig market by the fitted weight, then EV of the best price.
5. **Backtest** (`npm run backtest:games`): replays every game in date order. It
   refits the rating speed k, measures error against the closing spread and total,
   fits the margin and total spreads (the live model reads them back), checks the
   rest and injury priors against what actually happened, and fits the market
   weight per market.

## UFC fights: `src/lib/ufc/fightModel.ts` (v2)

The fight is replayed in date order, and features are read before each bout:
- opponent-adjusted Elo (finishes weigh more; debuts start from the pre-UFC record)
- per-minute stats shrunk toward the league: striking differential, strike
  defense, takedowns and takedown defense, knockdowns, submission attempts, control
- reach, experience, layoff, and weight-class moves

These are combined by L2 logistic regression (`stats/logistic.ts`).
`backtest:ufc-fights` trains on the oldest 60%, tunes on the next 20%, and
grades the newest 20% against v1 fighter math, Elo alone and the closing
moneyline. The page headline switches to v2 only if it beats v1. Missing: age,
the strongest single factor in public models, because our fight-data source
has no dates of birth.

## F1 races: `src/lib/f1/raceModel.ts`

- Car and driver pace ratings, updated after each race by Plackett–Luce (the
  multi-car Elo). The car learns faster and resets harder each season.
- Mechanical retirements count against the team's reliability; crashes
  count against the driver.
- 20,000 simulations give win, podium, points, DNF and beat-your-teammate odds.
- `backtest:f1` fits the learning rates on the winner's log loss (against a
  uniform pick and a points-so-far baseline) and checks podium calibration.
- Next: qualifying results (Jolpica `/qualifying`), since grid position is the
  biggest single input once it's known. Also circuit-type adjustments.

## What drives each sport (research notes)

Sources are mostly practitioner writing; academic work is cited where it
exists. Treat specific numbers as priors to test, not facts.

### MLB batter and pitcher props (next)
- **Pitcher strikeouts:** expected batters faced (pitch-count leash, the
  existing `pitcherRamp`) × K rate vs this lineup's K rate × park × umpire. Over-dispersed, so negative binomial.
- **Batter hits and total bases:** plate appearances from lineup spot
  (PAs fall about 0.1 per spot down the order) × per-PA outcome rates vs
  the starter's handedness (platoon) × park × weather (carry, temperature). Total bases come from a
  per-PA multinomial (1B/2B/3B/HR), not a single rate.
- **Home runs:** atLeastOne on HR rate × park × wind/temperature.
- Inputs commonly cited: lineup spot, extra-base rate, park run environment,
  pitch mix and chase tendencies ([Sportsgrid](https://www.sportsgrid.com/mlb/player-props)).
  The existing MLB matchup scripts (`matchup-park`, `matchup-platoon`,
  `matchup-weather-props`) already measure several of these.

### NHL
- **Shots on goal:** TOI (especially power-play time and unit) × shot-attempt
  rate × the opponent's shot suppression. Three-plus attempts per game is
  a strong signal for 2+ shots
  ([RotoWire](https://www.rotowire.com/hockey/article.php?id=63715),
  [Daily Faceoff](https://dailyfaceoff.com/news/nhl-player-prop-bets-feb-4)).
- **Goalie saves:** the opponent's expected shots × save % (shrunk hard; save %
  is mostly noise game to game)
  ([RotoWire](https://www.rotowire.com/hockey/article/nhl-picks-tonight-stanley-cup-finals-game-1-player-props-64241)).
- **Environment:** the total, plus the spread for empty-net and trailing-team shot volume.

### Soccer
- **Shots / shots on target:** per-90 rates × projected minutes (lineups confirm
  about an hour before kickoff, so stay conservative until then) × the team's
  expected goals from the 1X2 and total
  ([American Soccer Analysis](https://www.americansocceranalysis.com/glossary)).
  Shot volume and shot quality are worth modeling jointly
  ([arXiv 2512.00203](https://arxiv.org/abs/2512.00203v2)).
- **Anytime scorer:** atLeastOne on the player's share of team xG × the team's implied goals.

### Tennis
- Point-based (Klaassen–Magnus / Barnett–Clarke) serve and return models give
  games, sets and aces. Surface-aware Elo is the strongest history-only predictor.
  **The bookmaker consensus beat all 11 models** in Kovalchik's comparison,
  which is exactly why every model here blends with the market
  ([Ingram, NESSIS](https://www.nessis.org/nessis17/Ingram.pdf),
  [JSA serve forecasting](https://journals.sagepub.com/doi/10.3233/JSA-200345)).

### UFC
- Held-out results from public models: logistic regression on stat
  differentials (strike differential per minute rather than raw volume, takedown
  rates, reach, age, Elo). Around 66% winners on 8k held-out fights. Age is the
  strongest single factor, and the market odds add accuracy on top
  ([next-fight](https://next-fight.com/en/pronostics/methode),
  [UFC Fight IQ](https://www.patreon.com/UFCFightIQ/posts/how-does-model-131783351)).
- Our prior (`ufc/fighterStrength.ts`) covers fighters without UFC history.
  Next: refit on stat differentials, then method-of-victory and round props
  from finish rates.
