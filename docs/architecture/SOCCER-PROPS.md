# Soccer player props

Anytime goalscorer, anytime assist, goal or assist, shots, shots on target,
goalkeeper saves, to be carded and fouls, for every soccer league ESPN covers.
`/sports/soccer/props` (a league at a time, `?league=<slug>&match=<event id>`).

## Data (`soccer/playerStats.ts`)

Each finished ESPN match's summary carries both rosters with every player's
goals, assists, shots, shots on target, saves, cards and fouls, whether he
started, and his own substitution and red-card times. Minutes come from those
(a starter plays until he's subbed off or sent off; a substitute from when he
came on). Stored as `SoccerPlayerMatch` (one row per player per match) and
`SoccerPlayer` (team and position follow his latest match).

`/api/cron/soccer-player-stats` reads matches not yet read, newest first, eight
times a day (free), then looks up a few players' Wikipedia photos when ESPN has
no headshot. The "All sports — fill" workflow loops it for the first backfill
(about 400 days: this season and last).

## Model (`soccer/propModel.ts`)

    per-90 rate × minutes when he plays / 90 × matchup, as a count;
    P(over) = P(plays) × P(count > line)

- **Per-90 rate**: his production over his last 40 matches in every competition,
  each match's weight halving every 12 back, shrunk toward his position's league
  rate by 600 minutes of prior.
- **Role**: from his team's last six matches (recent ones weighted up): the
  share he played (with one match of even-odds prior) and his minutes when he
  did. Within ~100 minutes of kickoff ESPN's confirmed XI replaces it: a starter
  plays his usual starting minutes, a named substitute has an even chance of his
  usual minutes off the bench, and anyone not in the squad is dropped.
- **Matchup** (`soccer/shotContext.ts`): attacking props scale with the shots
  the opponent has allowed per match over its last ten, a keeper's saves with
  the shots on target the opponent has taken, each against the league average,
  ×1.06 at home (÷ for saves). Bounded to ×0.67–1.5.
- **Distribution**: Poisson for goals, assists and cards; negative binomial for
  shots (size 5), shots on target and fouls (6) and saves (12).
- **Line**: anytime props at 0.5; counts at the half-point where Over is
  closest to even. The sheet prices the whole ladder.

### Backtest

`npm run backtest:soccer-props [days] [priorMinutes] [halfLife] [damp] [playPrior]`
predicts every player his team would list before each match of the last 45
days from earlier matches only, and scores the call at ARCHR's line against a
constant forecast at the prop's own hit rate (Oct 2026, ~129K props):

| Prop | position | n | hit | model | LL | base LL |
|---|---|---|---|---|---|---|
| Anytime goal | F | 3,525 | 18.3% | 17.9% | 0.451 | 0.476 |
| Anytime goal | M | 7,933 | 7.3% | 7.6% | 0.246 | 0.262 |
| Shots on target | F | 3,525 | 37.9% | 36.5% | 0.629 | 0.663 |
| Shots | M | 7,933 | 40.5% | 42.5% | 0.642 | 0.675 |
| Saves | G | 1,465 | 48.8% | 46.9% | 0.673 | 0.693 |
| Fouls | M | 7,933 | 40.8% | 40.9% | 0.648 | 0.676 |
| To be carded | D | 6,757 | 12.7% | 11.2% | 0.378 | 0.380 |
| All | | 128,970 | 19.7% | 19.6% | 0.410 | 0.428 |

The settings above were fitted on this (prior minutes 200–900, half-life 8–20,
matchup damping 0.6–1.3, play prior 0.5–4). Every prop beats its base rate;
cards least, since referee and game state drive them more than the player.

## Book lines

None yet: The Odds API carries soccer player props (`player_goal_scorer_anytime`,
`player_shots_on_target`, …) per event at a credit per market. When they're
ingested they slot into the sheet's "Every book" table against ARCHR's price.
