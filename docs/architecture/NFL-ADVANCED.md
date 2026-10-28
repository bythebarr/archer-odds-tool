# NFL advanced line

Every NFL player sheet now carries what a box score doesn't: snap share, how his looks come, what they're worth, and his team's tendencies against the defense he faces.

## Data (`lib/nfl/nflverse.ts`, cron `nfl-advanced` daily 13:40 UTC)

nflverse (github.com/nflverse/nflverse-data) is free and refreshes the morning after games. We pull four files from it:

| File | What we take |
|---|---|
| `stats_player_week_<season>.csv` | Air yards, YAC, first downs, EPA (receiving, rushing, passing), CPOE, sacks, target share, air-yards share |
| `snap_counts_<season>.csv` | Offensive snaps and share (PFR ids) |
| `pbp/play_by_play_<season>.csv.gz` | Streamed, keeping 21 columns. Per player: red-zone targets and carries, goal-line carries (inside the 5), end-zone targets (air yards ≥ distance to goal), deep targets (20+ air yards), dropbacks, scrambles, deep attempts, red-zone pass attempts. Per team (`NflTeamGame`): plays, dropbacks, neutral pass rate and expected (xpass), red-zone plays, EPA |
| `players.csv` | nflverse id and PFR id → ESPN athlete id |

- **Games** join on both teams and the date, since division rivals meet twice. nflverse writes "LA" for the Rams; we use "LAR".
- **Writes** are one batched `UPDATE … FROM unnest` per 2,000 rows. A full season runs in under 10 seconds locally; locally all 392 games matched, and 24,006 of 24,171 logs were updated.
- **Backfill:** `?season=2025`.

## Model: expected TDs (`projection.ts`)

A touchdown mostly follows opportunity. League conversion rates come from least squares on 2025–26, and they're additive, so a goal-line carry also counts as a red-zone carry and a carry:

| Opportunity | TD rate |
|---|---|
| End-zone target | 0.257 |
| Red-zone target | 0.136 |
| Any target | 0.011 |
| Goal-line carry | 0.250 |
| Red-zone carry | 0.070 |
| Any carry | 0.009 |

The anytime-TD projection counts each past game as `0.9 × xTD + 0.1 × actual TDs` (`NFL_XTD_WEIGHT`). Everything downstream is unchanged: recency weighting, the season blend, matchup, game environment and the market blend.

| Anytime TD (no lookahead) | Log loss | Brier |
|---|---|---|
| Actual TDs (before) | 0.586 | 0.183 |
| xTD weight 0.9 | 0.525 | 0.173 |

Skill players only, 4,750 player-games. The full `backtest:nfl-props` run (16,971 player-games) shows log loss 0.209 → 0.169 and Brier 0.057 → 0.054, and the projection now beats the last-5 average.

### What didn't make it into the model

`scripts/experiment-nfl-usage.ts` tested an opportunity × efficiency model (share × team volume × efficiency); a 50/50 blend with production gained 0.8% MAE at best. `scripts/experiment-nfl-advanced.ts` tested air yards and snap trend in a time-split regression and gained 0.4–0.6%. Neither is worth the added complexity for yards, so those signals go on the sheet rather than into the projection. Red-zone and end-zone looks were the outlier: 8.3% on TDs.

## Sheet

The **Advanced** panel shows the last 5 games vs the season, by position:

- **WR/TE:**
  - snap share, air-yards share, aDOT and WOPR;
  - red-zone, end-zone and deep targets per game;
  - YAC per catch, EPA per target and first downs per target;
  - expected vs actual TDs.

  Plus a snap-share bar chart by game.
- **RB:**
  - snap share, red-zone and goal-line carries;
  - EPA and first downs per carry;
  - target share and YAC;
  - expected vs actual TDs.
- **QB:** dropbacks, EPA per dropback, CPOE, aDOT, deep-throw rate, sack and scramble rates, red-zone attempts.

**Offense & defense** shows his team's neutral pass rate and PROE, plays per game, red-zone plays, and EPA per play (pass and rush). It also shows the opponent's EPA allowed against the pass or the run (by position) and overall. Everything is ranked across the league (1st = most).
