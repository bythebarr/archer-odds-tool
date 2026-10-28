# MLB player props

`/mlb/props` (tabs with `/mlb`): every batter in the day's games and both
probable starters. Batters come from the posted lineup, or from everyone with
4+ of the team's last 10 games; starters are the probable pitchers. Each gets
ARCHR's projection on every stat: hits, total bases, home runs, H+R+RBI, RBIs,
runs, strikeouts, walks and stolen bases for batters; strikeouts, outs, hits,
walks and earned runs for starters.

- **Model:** `mlb/propProjection.ts`, unchanged. Volume × per-PA or per-batter-faced
  rate, steadied toward the league, × platoon (tonight's starter's hand), the
  opposing starter's or lineup's strikeout rate and park, as a full distribution.
- **Matchup inputs** (`queries/mlbProps.ts`): the opposing starter's strikeouts
  per batter faced over his last 15 starts; the opposing lineup's strikeouts per
  PA over the last 30 days.
- **Pricing** (`mlb/propsSlate.ts`): the shared pipeline (`propModel/price.ts`):
  per-stat calibration, then blended with the books' no-vig line where books
  have posted (`CurrentPlayerPropLine`), or ARCHR's own line (the half-point
  nearest even) before they do. The sheet prices the whole ladder.

## Calibration (`npm run backtest:mlb-props`, 2026 season)

Each game projected from that player's earlier games only, at the line books
hang most often:

| Prop | line | games | Brier | base | per-stat shrink |
|---|---|---|---|---|---|
| Hits | 0.5 | 40,000 | 0.241 | 0.244 | 0.81 |
| Total bases | 1.5 | 40,000 | 0.218 | 0.219 | 1.15 |
| Home runs | 0.5 | 40,000 | 0.097 | 0.097 | 1.02 |
| Batter Ks | 0.5 | 40,000 | 0.235 | 0.240 | 0.94 |
| H+R+RBI | 1.5 | 40,000 | 0.240 | 0.244 | 1.10 |
| Pitcher Ks | 5.5 | 2,620 | 0.212 | 0.220 | 1.28 |
| Outs | 16.5 | 2,620 | 0.230 | 0.238 | 0.81 |
| Hits allowed | 5.5 | 2,620 | 0.232 | 0.237 | 0.81 |
| Earned runs | 2.5 | 2,620 | 0.242 | 0.244 | 0.55 |

The shrink is the old 0.85 × each stat's held-out refit
(`MLB_CALIBRATION_BY_STAT`). Home runs are a coin flip against their base rate,
so the model barely moves them; pitcher strikeouts are where it's strongest.
