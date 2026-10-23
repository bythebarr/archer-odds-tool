# NBA player props

> **Shipped 2026-10-22.** `/nba/props` finder, ESPN box-score game logs, Parlay
> bulk prop odds. Hit rates only — no projection, no model EV.

## What a member sees

`/nba/props?date=…&stat=…&side=over|under&sort=…&game=…` lists every player
prop on the board for one stat. Each row shows:

- **The consensus line**: the number most bettable books are hanging. If a
  book hangs a different number, it shows up as "+N alt" and isn't mixed in.
- **Best Over and best Under at that line** across bettable books. Pinnacle is
  never shown as the best book (see `bestBettableLine`).
- **Hit rates at that exact line**: L5 / L10 / L20, this season, and the last 20
  home or away games (matching tonight's venue). Sample sizes are always shown.
- **Context**: the player's average for the stat over L10, and minutes over L5.

Sort by L10 hit rate, by L10 average minus the line, or by best price. The
`/nba` board and every NBA game page link in.

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
