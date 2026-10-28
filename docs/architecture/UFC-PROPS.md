# UFC fighter sheets and props

Tap any fighter, on a bout page (his photo or his card under **Fighter props**) or on `/ufc/props`, for the same sheet every sport has: line ladder, by-fight chart, projection, hit rates, his metrics, the matchup, books and his last 10 fights.

## Data: the full UFC history, free

`lib/ufc/ufcStatsArchive.ts` imports every UFC event since 1994 from UFCStats, through a public mirror of its scrape (github.com/Greco1899/scrape_ufc_stats, refreshed after each card). That covers results, each round's stat line, and each fighter's height, reach, stance and date of birth. The cron is `ufc-history`, every 3 hours. It is resumable: the first runs walk the history about 40 events at a time, then only new cards.

It **merges into the Cito rows** rather than writing beside them.

- **Fighters.** A fighter matches on his UFCStats id once linked, else on his normalized name. If Cito spells a name differently, a bout on that card with the other fighter in it identifies him: the unmatched name is that bout's other corner.
- **Events** match on their date (±36h).
- **Bouts** match on the pair of fighters within the event.
- What Cito wrote stays. The archive only fills results, stats and physicals that are missing.
- New rows carry `ufcStatsId` (fighter, event and bout) and Cito keys `ufcstats:<hash>`.

## Props model (`lib/ufc/propModel.ts`, fitted by `scripts/fit-ufc-props.ts`)

The model takes per-minute rates from his UFC fights, weights them by recency (half-life 18 months), and shrinks them toward his weight class's averages. It then applies three adjustments:

- **× what the opponent allows** (damped).
- **× how long the fight lasts.** A decision runs the full distance. A finish lands in a round (52/30/15/2/1.5% for R1–R5), anywhere within it. The finish chance comes from both fighters' finish rates around the division's.
- **Counts at a given length** are negative binomial.

| Stat | Prior minutes | Opponent damp | NB size | Log loss vs division-only |
|---|---|---|---|---|
| Significant strikes | 25 | 0.9 | 6 | 0.527 vs 0.557 |
| Takedowns | 15 | 0.6 | 1 | 0.456 vs 0.489 |
| Knockdowns | 50 | 0.6 | 5 | 0.470 vs 0.479 |

The finish chance (10 prior fights) scores 0.672 vs 0.693 for a coin flip. The backtest covers 15,160 fighter-fights since 2010; each is scored across a ladder of lines.

### Debuts and thin records

- **A debut is his division's average, tilted by what the opponent allows.** Backtested on debuts alone, that still beats the division average (sig strikes 0.532 vs 0.538, takedowns 0.475 vs 0.477).
- **His tape takes over gradually.** Five rounds of tape is 25 minutes, so his own numbers are only half of the sig-strike rate. The sheet shows the split ("his tape is 50% of it").
- **The flags:** "UFC debut" for no UFC fights, "N UFC fights" for fewer than 3 fights or under 30 minutes.
- **Win model** (`fightModel.ts`, `scripts/experiment-ufc-debuts.ts`). Debutants beat UFC veterans 41.9% of the time overall, but the rate drifts by era: 33% before 2010, 48.6% since 2022 (Contender Series signings). Neither a fixed starting rating nor a fixed debut penalty can be right in both eras; a debut feature scores better overall but worse on today's debuts, because it learns the old era's penalty. So:
  - **A debut starts 15 Elo under the active roster's average**: everyone who fought in the last 18 months, so the start follows the era. His pre-UFC record (Cito) moves it from there.
  - **New fighters' ratings move fast**: K 60 (was 40) for their first 8 fights (was 5).

  | Test bouts (newest 20%) | Before | After |
  |---|---|---|
  | All | 0.6438 | 0.6405 |
  | With a debutant | 0.6531 | 0.6494 |
  | A fighter on 1–2 UFC fights | 0.6561 | 0.6522 |
  | Both fighters on 5+ | 0.6336 | 0.6307 |

  In the full `backtest:ufc-fights` run, v2 goes 0.6439 → 0.6412 and Elo alone 0.6764 → 0.6652. Pulling thin records toward 50% made things worse. A strength term (Elo) added nothing to the props.
- **The bout page** names a debut or a fighter with 1–2 UFC fights in the fight-model card, and says how his number was built.

## Sheet

The sheet shows, in order:

1. Record, age, reach and stance.
2. The line ladder.
3. A sig strikes / takedowns / knockdowns chart by fight.
4. The projection: his rate, the opponent factor, expected minutes and the finish chance.
5. Hit rates: L3, L5, L10, last 2 years, UFC career, same-length fights and the rematch.
6. **Fighter metrics.** L5 vs UFC career vs division for:
   - strikes landed and absorbed per minute;
   - striking accuracy and defense;
   - takedowns per 15 minutes, takedown accuracy and defense;
   - knockdowns and sub attempts per 15 minutes;
   - control share and average fight time.

   It also shows where he lands (head/body/legs and distance/clinch/ground) and sig strikes by round.
7. The matchup: what the opponent absorbs and gives up, the finish chance, and how each man wins and loses.
8. Books (projected).
9. His last 10 fights.
