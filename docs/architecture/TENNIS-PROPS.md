# Tennis player props

`/sports/tennis/props`: every ATP/WTA main-draw singles match in the next 36 hours, both players, four stats (games won, total games, aces, double faults), all on the shared props kit (`components/props/kit.tsx`), the same layout NBA uses.

## Data (all free)

| Source | What | Where |
|---|---|---|
| Sackmann archive (to May 2026) | results + serve line (aces, DFs, 1st in/won, 2nd won, service games, BPs) + minutes | `lib/tennis/archive.ts`, `fillServeStats` back-fills serve columns on old rows |
| ESPN scoreboard results | scores since the archive stops (no serve stats) | `lib/tennis/espnResults.ts` |
| ESPN scoreboard fixtures | upcoming main-draw singles → `SportEvent` (`espn:tennis:<competition>`), league `tennis/espn-<tour>-<event>` | `lib/tennis/espnFixtures.ts`, cron `tennis-fixtures` (every 3h) |
| Elo | rebuilt daily over everything | cron `tennis-history` (archive → ESPN results → dedupe → ratings) |

ESPN returns a combined event (slams, Indian Wells…) from **both** tour endpoints; the tour comes from the draw slug (`mens-` / `womens-`), not the endpoint. `dropDuplicateEspnTennisRows` removes copies written before that fix. A fixture an odds feed already lists (same pair within a day) is left to the feed's event.

Surface for an ESPN tournament: venue city → the archive's usual surface for that city (`tennisSurfaceByCity`); the league's providerKey is `espn:<tour>:<city>:<eventId>`.

## Model (`lib/tennis/propModel.ts`, fitted by `scripts/fit-tennis-props.ts` on 2019–2026)

- **Total games**: best of 3 ≈ 23.36 − 18.38·(p−½)² (sd 5.9); best of 5 ≈ 39.33 − 45.91·(p−½)² (sd 9.3). p = Elo win chance.
- **Games won**: share ½ + 0.357·(p−½) (sd 0.138) of the total.
- **Aces / DFs**: his rate per service game (last 40 charted matches, shrunk to the tour's by 60 service games) × the opponent's on return (half its tilt) × half the expected games; negative binomial, size 6 / 8. Log loss: aces 0.677 vs 0.684 base, DFs 0.679 vs 0.686.
- ARCHR's line = the half-point closest to 50/50; hit rates count only matches of the same format (best-of-3 vs 5).
- "Thin record" flag: either player has under 10 rated matches.

## Sheet

Line ladder → games-by-match chart → projection factors → hit rates (L5/L10/L20/season/last season/surface/h2h) → serve & return (L10 / L40 charted matches) → matchup (win chance, Elo, surface Elo, h2h) → books (projected) → last 10 matches.
