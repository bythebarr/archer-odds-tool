# NBA adapter

> **Shipped 2026-10-22** (feed, line shopping, grading). `/nba` board and game
> pages, Slate presence, odds poll, ESPN results sync. No model EV.

## What it is

NBA runs on the same pipeline as NFL — `src/lib/teamLeague/` — with its own
config in `src/lib/nba/league.ts`:

| Piece | Where |
| --- | --- |
| 30-team allowlist (+ aliases) | `src/lib/nba/teams.ts` |
| League config, season boundary | `src/lib/nba/league.ts` (`NBA_LEAGUE`, `nbaSeasonOf`) |
| Odds poll (`basketball_nba`, h2h/spreads/totals, us+us2) | `src/lib/teamLeague/ingest.ts` |
| Results (ESPN `basketball/nba` scoreboard) | `src/lib/teamLeague/results.ts` |
| Adapter | `src/lib/engine/adapters/nba.ts` |
| Cron routes | `/api/cron/poll-odds-nba`, `/api/cron/sync-results-nba` |
| Pages | `/nba`, `/nba/[gameId]` |

Adding another team league (NHL, WNBA, …) is the same shape: an allowlist, a
`TeamLeague` config, a Sport enum value + the team-pair check widened, two
one-line cron routes, two thin pages, and a `SPORT_METAS` entry.

## Decisions worth knowing

**The allowlist is not optional.** The July coverage audit counted 9–13
`basketball_nba` events when the NBA plays no games at all — the key carries
other basketball, the same trap that put CFL games under the NFL key. Anything
not on the 30-team list is skipped and named in the poll log.

**ESPN says "LA Clippers"; books say "Los Angeles Clippers".** Without the alias
in `teams.ts` every Clippers game would price but never grade. Aliases are an
explicit list, never fuzzy matching — a wrong match puts another game's prices
on the board.

**Season is named for the year it starts.** Opening night in October 2026
through the June 2027 Finals is season 2026; the boundary sits at September 1.

**Polling is denser than NFL's.** NBA lines move on injury and rest news through
the afternoon, so `vercel.json` ticks `poll-odds-nba` five times a day (10:30am to
9pm ET, 6 credits each, 30/day) with a 75-minute floor between polls. Results
sync twice a day with a four-day lookback, free.

**Best line = bettable books, consensus number.** The board chips and the game
page's BEST marker skip Pinnacle (it prices, but members can't bet it) and only
compare prices at the number most books are hanging. This applies to every
sport's ladder, not just NBA — see `src/lib/odds/bestPrice.ts`.

## Not built yet (in order of value)

1. ~~**Player props.**~~ Shipped — see docs/architecture/nba-props.md.
2. **Alternate spreads/totals.** Same per-event fetch MLB uses; costs credits
   per event.
3. **A model.** Only after a CLV backtest beats the close — see
   `docs/architecture/calibration.md`.
