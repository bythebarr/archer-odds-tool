# The all-sports engine

Every sport and league the books hang lines on — soccer's 60-odd competitions,
every tennis tournament, college sports, hockey at home and abroad, cricket,
rugby, the AFL, golf majors, futures and, with odds-api.io, table tennis, darts,
esports, volleyball, snooker and padel — on one pipeline, one model framework
and one set of pages. The deep NBA, NFL, MLB and UFC pipelines are unchanged;
this covers everything else (`src/lib/allSports/`).

## Data

| Piece | What | Where |
|---|---|---|
| `League` | one per competition, synced from the feed's own catalog | `poll.ts › syncCatalog` |
| `SportEvent` | each game, with its result once final | feed events, feed scores, ESPN backfill |
| `SportEventLine` | latest price per (game, book, market, period, side, number) | `poll.ts › storeLines` |
| `Competitor` | a team or player's logo, looked up once | `logos.ts` |

A league id is `"<sport>/<slug>"` (`soccer/epl`, `table-tennis/czech-liga-pro`).

## Feeds (`feed.ts`, `feeds/`)

One interface, two adapters:

- **The Odds API / ParlayAPI** (`feeds/toa.ts`): 16 sports, ~180 leagues. The
  league list, events list are free; odds cost one credit per market (ten
  named books = one region), whatever the number of games; scores cost 2.
- **odds-api.io** (`feeds/oddsApiIo.ts`): 34 sports — everything above plus
  table tennis, darts, esports, volleyball, snooker, padel, badminton, futsal,
  handball leagues — from 400+ books including every US book, Circa and
  theScore Bet. Billed per request (5,000/hour on paid plans), ten games a request.

`feeds/index.ts` runs whichever has a key. With both, The Odds API keeps its
sports and odds-api.io fills in the rest. `ALL_SPORTS_FEED=toa|oddsapiio|both`
forces it.

## Polling (`poll.ts`, `cadence.ts`)

`/api/cron/poll-all-sports` does whatever is due and stops at 50 seconds:

1. catalog every 6 hours, schedules every 30 minutes (free on TOA);
2. odds by each league's next game: within 2 hours every 10 minutes, within a
   day every 30, within 3 days every 3 hours, else every 12; futures daily;
   a league with no known schedule gets a discovery poll every 6 hours;
3. results every 2 hours for leagues with a game that should have finished.

Two guards keep it from eating the account:
- a **budget governor** (`budgetStretch`): `ALL_SPORTS_TOA_BUDGET` (default
  1.5M credits/month) or `ALL_SPORTS_IO_BUDGET`; when spend runs ahead of the
  month's pace every interval stretches, up to 8×;
- a **reserve** (`ALL_SPORTS_RESERVE`, default 20,000 credits): below it, other
  sports pause so NBA/NFL/props never run dry.

How often it actually runs is the cron's call: on Vercel Hobby, eight times a
day (vercel.json); on Pro, set one entry to `*/5 * * * *` and the cadence above
takes over.

### Budget (The Odds API)

Rough steady state with ~70 leagues in season and ~25 playing on a given day,
running every 5 minutes: ~4,200 credits/day for leagues with games, ~900 for
the rest, ~600 for scores — **~175K credits a month**, on top of the deep
pipelines. That fits the 5M plan with room to spare; it doesn't fit 100K.

## Before any book posts

Every league ESPN covers is seeded from the league directory (`seedEspnLeagues`),
with no odds feed needed, and its next week of fixtures is synced every six hours
(`syncEspnFixtures`, ids `espn:<id>` — the same id the result lands on later).
Those games show ARCHR's own prices from the model (`archrRead`): fair moneyline
(1X2 where the sport draws), and the handicap and total on the half-point, as
dashed "ARCHR" cells on the board and an "ARCHR's prices" panel on the event
page. When the odds feed lists the same game, its copy (with every book's
price) replaces ESPN's on the board (`dropEspnTwins`). The GitHub Action
"All sports — fill" runs the same job on demand.

### Free prices from ESPN

ESPN lists one sportsbook's current line (DraftKings) on every US-sport game it
carries — moneyline, spread and total with prices — and on each soccer match's
summary. `/api/cron/espn-odds` (eight times a day, no key, no credits) stores it
as that book's quotes: on NBA, NFL and MLB games through the same storage as any
feed, and on every ESPN all-sports event (`odds/espnOddsPoll.ts`). It's one
book, so all-sports offers price from a single book (`minBooks: 1`); a paid feed
adds the rest of the books on top.

Player props work the same way: every rotation player in the day's NBA games
(and every QB/RB/WR/TE with a role in the week's NFL games) gets ARCHR's line
on the core stats — the projection to the nearest half-point — listed after the
props books have posted, until the books' line replaces it.

## History and logos (`espn.ts`, `logos.ts`)

`/api/cron/backfill-all-sports` (twice a day) takes every league ESPN covers
(most of world soccer, NHL, college basketball and football, WNBA, EuroLeague,
NBL, CFL, UFL, AFL, NRL, Six Nations, PLL): 15 months of results for a new
league (this season and last), then the latest month on refresh; each team's
crest, abbreviation and color; and the league logo. College scoreboards go day
by day over the whole division (ESPN lists only ranked teams otherwise).

Every other team or player gets its logo from Wikipedia: a search for the name
plus the sport, accepted only when the page is described as that sport's team
or player (and, for a person, carries their surname). `/api/logo` serves it as
a redirect; the backfill job warms the next four days' names. A rate-limited
answer isn't remembered as a miss.

## Models (`model/`)

Each sport has a family (`sports.ts`):

| Family | Sports | Model | Prices |
|---|---|---|---|
| goals | soccer, hockey, futsal, bandy… | attack/defense Poisson (`soccer/poisson.ts`), league scoring and home edge measured first | 1X2, 2-way ML (hockey: OT split), handicaps incl. quarter lines, totals, team totals, BTTS, DNB, 1st half |
| points | basketball, football, rugby, AFL, handball, baseball… | opponent-adjusted points ratings (`gameModel/ratings.ts`), margin and total spreads fitted on the league's own misses | ML, spreads, totals, team totals, 1st half |
| winner | tennis, table tennis, darts, esports, snooker, combat… | Elo pooled across the sport's tournaments; tennis seeds every player from the ATP/WTA archive Elo with the tennis calibration shrink | moneyline (games/sets lines are market-only) |
| field | golf, cycling | market only | futures |

Every line runs through `gameModel/offers.ts` — the same builder as the NBA
board — and is **blended with the books' no-vig consensus** (sharp books ×3).
The model's weight is 0.25–0.30 at most, scales with how many games both sides
have (none below 3 — the read is then the market's, labeled as such), and fades
on long shots (`tailScale`: full weight from a 20% market chance, none at 0).

### Backtest

`npm run backtest:all-sports` replays every league with 150+ results, each game
predicted only from the games before it, and scores log loss against the
league's own home/draw/away base rates. On ESPN history (Oct 2026):

| League | games | model LL | base LL |
|---|---|---|---|
| Premier League | 396 | 1.048 | 1.091 |
| Bundesliga | 305 | 0.989 | 1.074 |
| Serie A | 396 | 1.013 | 1.084 |
| Champions League | 114 | 0.948 | 1.002 |
| NHL | 1,664 | 0.682 | 0.692 |
| College basketball | 4,920 | 0.605 | 0.693 |
| College football | 893 | 0.591 | 0.680 |

Hockey's learning rate (0.006) and the points k (basketball 0.12, football
0.15) were fit on this; every league beats its base rate. The market still wins
head to head in most leagues, which is why it carries most of the weight.

## Pages

- `/sports` — every sport in season; `/sports/<sport>` — league chips, futures,
  the week's games; `/sports/<sport>/<league>` — games by day, or a futures board.
- `/sports/<sport>/event/<id>` — the UFC-style breakdown: face-off with ARCHR's
  win chance (draw shown for 3-way sports), ARCHR vs the book, model vs market
  vs blend, tale of the tape, why, last meetings, then every market and book
  (the shared `GameMarketBoard` and `BetSheet`).
- Home lists the next big games across sports; `/soccer` and `/tennis` redirect
  to their boards.

## Env

| Var | Default | |
|---|---|---|
| `ODDS_API_KEY` / `PARLAY_API_KEY` | — | The Odds API feed (already used by the deep pipelines) |
| `ODDS_API_IO_KEY` | — | odds-api.io feed |
| `ODDS_API_IO_BOOKMAKERS` | DraftKings, FanDuel, BetMGM, Caesars, Fanatics, BetRivers, theScore Bet, Hard Rock, bet365 NJ, Circa | the books selected on the odds-api.io plan |
| `ALL_SPORTS_FEED` | auto | `toa`, `oddsapiio` or `both` |
| `ALL_SPORTS_TOA_BUDGET` / `ALL_SPORTS_IO_BUDGET` | 1.5M / 3M | monthly pace for the governor |
| `ALL_SPORTS_RESERVE` | 20,000 | TOA credits kept back for the deep pipelines |
