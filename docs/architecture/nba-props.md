# NBA player props

> **Shipped 2026-10-22.** `/nba/props` finder, ESPN box-score game logs, Parlay
> bulk prop odds. Hit rates only — no projection, no model EV.

## What a member sees

`/nba/props` loads the whole day's slate in one go (`getNbaPropsSlate`), and the
browser recomputes everything from there (`src/lib/nba/propsMath.ts`). That
means switching stat, Over/Under, sort, game, or searching by player happens
instantly, with no page reload. The controls stick to the top of the screen
while you scroll. Each choice is written into the URL, so a view can be shared,
and saved in a cookie, so the server opens on the member's last view without a
flash.

**Each card** shows:
- the player's headshot with their team's logo;
- the opponent's logo and the tip time;
- the main line and the player's average over their last 10 games;
- a last-10 strip (one tick per game, filled when that side cashed) with the
  L10 hit rate;
- the best bettable price, with the book's badge;
- L5 / L20 / season / home-or-away hit rates;
- how many books hang the main line, and how many alt lines exist.

**Tapping a card** opens the player sheet: a bottom sheet on phones, a dialog on
desktop. The sheet lets the member:
- switch between the stats this player has props for;
- pick any line any book hangs (the main line is marked "MAIN");
- toggle Over/Under.

It shows:
- hit-rate tiles for the chosen line;
- a last-20-games bar chart against the line (tap a bar to see that game);
- every book's Over and Under at that line, with the best bettable book
  highlighted and sharp books (Pinnacle) marked as reference only;
- a last-10 game-log table.

The game-log table is also the chart's second encoding. In light mode the
"missed" bar color is under 3:1 contrast, so the result can't depend on color
alone.

**Images.** Headshots and team logos come from ESPN's public CDN (`nbaHeadshotUrl`
and `espnTeamLogoUrl` in `src/lib/logos.ts`). This is the same hotlinking MLB
does with mlbstatic. NBA and NFL game boards use the same logos. If an image
fails to load, the colored-initials badge shows instead.

## Data flow

| Step | Code | Source | Runs |
| --- | --- | --- | --- |
| Player game logs | `src/lib/nba/gameLogs.ts`, `espnBoxScore.ts` | ESPN summary (free) | rides `sync-results-nba` (2×/day, 4-day lookback) |
| Prop odds | `src/lib/nba/props.ts` | Parlay `/sports/basketball_nba/props`, one bulk call (~3 credits) | rides `poll-odds-nba` (5×/day) |
| Finder query | `src/lib/queries/nbaProps.ts` | DB | per request |

Riding the existing cron ticks keeps `vercel.json` unchanged (see
`RideAlongJob` in `teamLeague/cronHandlers.ts`). Each ride-along writes its own
PollLog row (`sync-gamelogs-nba`, `poll-props-nba`), so a failure in one shows up
on its own.

Tables: `NbaPlayer` (keyed by ESPN athlete id), `NbaPlayerGameLog`,
`NbaPropSnapshot` (append-only), and `CurrentNbaPropLine`. They are separate from
the MLB prop tables because the identity source and the stats both differ.

## Decisions worth knowing

- **DNPs are not stored.** A book voids a prop on a player who doesn't play, so
  a DNP isn't a miss.
- **Box scores are parsed by column name, never by position.** A team block
  missing a needed column is dropped and named in the sync summary.
- **Players are matched by normalized name.** Matching ignores accents, case
  and punctuation, so "P.J." matches "PJ" and "Jokić" matches "Jokic". A
  suffix-less alias ("Jaren Jackson") counts only when exactly one player owns
  it. Names that don't match are listed in the poll summary; usually it's a
  player with no logged game yet.
- **Market keys are an allowlist** (`NBA_MARKET_KEY_TO_STAT`). Any key the feed
  sends that isn't mapped is counted by name in the poll log. Two-player,
  first-basket, and double/triple-double markets are deliberately left out.
- **`*_alt` lines.** A whole-number alt line is treated as a milestone ("25+") →
  Over 24.5, over only, which is the convention MLB's alt lines follow on this
  provider. A half-point alt line is kept as an ordinary over/under.
- **The current-line table holds only live lines.** After each poll, any line
  that poll didn't refresh is deleted, so a moved line doesn't linger.

## Before trusting it

None of this has run against live feeds yet; it was verified against stubbed
payloads shaped from the documented formats.

1. `npm run backfill:nba:logs`: last season through yesterday, so L10/L20 are
   full on day one. This is free, and the run lists every game it couldn't read.
2. `npm run probe:nba:props` (~3 credits): lists the market keys the provider is
   actually sending. Add any real spellings that are missing to
   `NBA_MARKET_KEY_TO_STAT`.
3. Check the first `poll-props-nba` response for `unmatchedPlayers` and
   `unmatchedEvents`.

## Not built

- A projection or model EV. Hit rates are history, and the MLB backtest showed
  raw trailing rates overstate hot players (`props/projection.ts`). An NBA
  projection needs its own backtest first.
- Grading and posting NBA prop plays to Discord.
- Defense-vs-position or pace context.
