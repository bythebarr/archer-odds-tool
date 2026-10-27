# Odds API budget

How The Odds API bills, and what our polls cost.

## The billing rule
- A call costs **one credit per market returned, per region**. The number of
  books doesn't matter, but every region you add doubles the cost.
- Naming books (`bookmakers=`) instead of regions bills **every 10 books as one
  region**.
- We ask for exactly 10 books (`TOA_BOOKMAKERS` in `odds/oddsApiClient.ts`):
  DraftKings, FanDuel, BetMGM, Caesars, ESPN BET, Fanatics, BetRivers, Hard Rock,
  bet365, and Pinnacle as the sharp reference that's never recommended. That's
  half the old two-region cost, and it adds Pinnacle, which the US regions never
  returned. BetParx was dropped; `ODDS_BOOKMAKERS` overrides the list.

## What the polls cost (one region-equivalent)

| Poll | Credits per call | Cadence | ≈ Credits / month |
|---|---|---|---|
| NBA main lines (bulk, all games) | 3 | 5×/day | 450 |
| NBA per game: props + alternates (~24) + extra game markets (~28) | ~52 per game | 5×/day, games within 14h (~7.5/day) | ~58,000 |
| NFL main lines | 3 | 2×/day | 180 |
| NFL per game: same shape | ~52 per game | ~3× per game, games within 30h (~16/week) | ~11,000 |
| UFC, soccer, tennis | small | as today | ~3,000 |
| **Total, NBA + NFL season** | | | **~72,000** |

That fits the 100K plan. MLB (April–October) adds its own load in spring, so
re-check this when MLB props go live.

## Going closer to real time (with Vercel Pro)
Main lines are cheap (3 credits per call covers every game), so they can poll
often. The deep per-game markets are where the credits go.

| Setup | ≈ Credits / month |
|---|---|
| Main lines every 10 min (9am–1am ET), deep markets 5×/day | ~90,000 (100K plan) |
| Main lines every 10 min, deep markets hourly in the last 3h + 4× earlier | ~115,000 (next plan up) |
| Everything every 10 min | 400,000+ |

Every poll records its credits in `PollLog` / `PollCreditLog`, so real usage
can replace these estimates after a week.
