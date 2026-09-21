# Model data/provider requirements ledger

> Policy and known-categories document only. This lists what data each
> model-eligible sport needs to run and to be honestly evaluated, and sorts
> what's already available from what isn't. **It does not commit to adding any
> provider, spending any money, or building any new sport.** Anything not
> already verified elsewhere in this repo's docs/code is marked "requires
> provider evaluation" rather than guessed at — no price, rate limit, or
> capability below is invented.

## Categories

Every data need for a model falls into one of these. A sport's row below
tags each requirement with the category it belongs to.

| Category | Meaning |
|---|---|
| **Existing stored data** | Already in this repo's Postgres via an existing sync/poll path — no new integration needed. |
| **Free current data** | A live/current-season source that costs nothing and needs no credential, already wired or evaluable from public docs (e.g. ESPN's public scoreboards, MLB Stats API, Jolpica). |
| **Free historical data** | A historical archive available at no cost (e.g. the Sackmann tennis archive, football-data.co.uk, nflverse). |
| **Paid/licensed current data** | A live odds/results/stats feed requiring a paid subscription or per-credit cost (e.g. ParlayAPI, The Odds API paid tiers, OddsBlaze, Cito). |
| **Paid/licensed historical data** | Historical odds/results/stats requiring payment or a license the project does not currently hold. |
| **Credentials/environment variables** | What secret/config this data source needs, if already known from code (`.env.example`, `src/lib/odds/*`, etc.). |
| **Rate limits/cost considerations** | Anything already documented about volume/credit constraints (see `docs/architecture/provider-coverage.md`). Left blank/marked unverified where not already measured. |
| **Storage/display licensing considerations** | Whether the provider's terms are known to restrict storing history or displaying its data publicly. **Not evaluated for any provider below** — flagged as a standing gap, not assumed permissive. |

**Ground rule:** nothing in this document should be read as "we have decided
to pay for X." It is an inventory, produced from what this repository's own
code and docs already establish (`docs/architecture/provider-coverage.md`,
`docs/architecture/EDGE-BASELINE-AUDIT.md` §5/§12/§13, `docs/architecture/
CFB-V0.md`), plus explicit gaps for what would need new evaluation.

---

## CFB game lines

| Category | Status |
|---|---|
| Existing stored data | The `/cfb` board itself still persists nothing (`docs/architecture/CFB-V0.md` "Architecture": "zero Prisma involvement"). A separate, manual, append-only forward-prediction capture now exists (`docs/architecture/CFB-V0.md` "Forward-prediction capture", `npm run capture:cfb:predictions`) writing to the generic `PredictionRun`/`ModelPrediction` tables — but this stores the MODEL's own win-probability/projection output, never a market line, and does not change anything else in this row: no odds/closing-line data is captured or available, so CLV/spread/total-market evaluation is still blocked exactly as below. |
| Free current data | ESPN's public college-football scoreboard, already wired (`src/lib/cfb/espnScoreboard.ts`, CFB-V0.md "Data source") — schedule, scores, neutral-site flag, team records. No key, read-only. |
| Free historical data | Not currently ingested. ESPN's same scoreboard endpoint likely supports historical date queries (per its `?dates=YYYYMMDD` shape already used), but this has not been verified for CFB specifically, and no multi-season backfill script exists yet. **Requires provider evaluation** (confirm ESPN's historical date range/coverage before relying on it for a backtest). |
| Paid/licensed current data | No CFB odds provider is wired at all (CFB-V0.md: "no paid API, no scraping" — lines are typed in by hand into `localStorage`). Whether ParlayAPI/The Odds API carry CFB odds, and at what coverage/book depth, is **not verified** — `provider-coverage.md`'s measured table does not include CFB. **Requires provider evaluation.** |
| Paid/licensed historical data | Not evaluated. **Requires provider evaluation.** |
| Credentials/environment variables | None currently — CFB v0 needs no key. A future odds integration would need whatever the chosen provider requires (see the MLB/NFL rows for the pattern: `PARLAY_API_KEY`/`ODDS_API_KEY`/`ODDSBLAZE_API_KEY`). |
| Rate limits/cost considerations | Not evaluated for CFB. |
| Storage/display licensing considerations | Not evaluated. |

## NFL game lines

| Category | Status |
|---|---|
| Existing stored data | `Game`, `OddsSnapshot`, `CurrentOddsLine`, `GameOutcome` are already populated for NFL via `poll-odds-nfl`/`sync-results-nfl` crons (`docs/architecture/EDGE-BASELINE-AUDIT.md` §6). |
| Free current data | ESPN's free scoreboard already provides NFL results/settlement (`src/lib/nfl/espnScoreboard.ts`, EDGE-BASELINE-AUDIT.md §5). |
| Free historical data | nflverse `games.csv` (free), already used to backtest the Elo model (`docs/architecture/calibration.md` "NFL (biggest sport)" — 7,276 games 1999–2025, results + closing spread/total, moneylines 2019+). |
| Paid/licensed current data | ParlayAPI (preferred, carries Pinnacle) or The Odds API — already wired (`src/lib/odds/oddsApiClient.ts`). Measured coverage: 35–36 events, 3–11 bettable books, Pinnacle present, 67–82 prop markets (`provider-coverage.md`, one snapshot, noted as volatile — "re-run near game time before trusting"). **Caveat already documented in this repo:** the odds-provider NFL key also returns CFL events, filtered by a 32-team allowlist (`provider-coverage.md` "Correction," `src/lib/nfl/teams.ts`). |
| Paid/licensed historical data | Not currently ingested beyond what nflverse's free historical odds columns provide (spread/total closing lines, moneylines from 2019+) — no paid historical odds archive is wired. |
| Credentials/environment variables | `PARLAY_API_KEY` or `ODDS_API_KEY`, optionally `NFL_ODDS_PROVIDER=oddsblaze` + `ODDSBLAZE_API_KEY` (`EDGE-BASELINE-AUDIT.md` §5). |
| Rate limits/cost considerations | ParlayAPI is per-credit/paid; The Odds API has a usable free tier for dev/testing (`.env.example`). Exact current rate limits/credit costs are not re-verified here — see `provider-coverage.md`'s own caution that book/event counts are "a floor, not a measurement." |
| Storage/display licensing considerations | Not evaluated. |

## Football player props

| Category | Status |
|---|---|
| Existing stored data | None for NFL — `PlayerPropSnapshot`/`CurrentPlayerPropLine` are hardcoded to `MlbPlayer`/`StatCategory` at the schema level (`EDGE-BASELINE-AUDIT.md` §9); a non-MLB prop cannot be stored without a schema migration regardless of provider availability. |
| Free current data | None known. |
| Free historical data | None known. |
| Paid/licensed current data | ParlayAPI measured at 67–82 NFL prop markets, 5 prop books, in one snapshot (`provider-coverage.md`) — coverage exists at the provider level, but nothing in this codebase consumes it for NFL today. |
| Paid/licensed historical data | Not evaluated. Real historical prop *odds* (as opposed to outcomes) are documented as generally unavailable even for MLB's own props backtest (`MLB-MODEL-INVENTORY.md` §5: `backtest-props-edge.ts` "a proxy, not proof... real historical prop odds don't exist in this dataset") — the same constraint should be assumed for NFL props until proven otherwise. **Requires provider evaluation.** |
| Credentials/environment variables | Same as NFL game lines, if reusing ParlayAPI. |
| Rate limits/cost considerations | Per-event prop endpoint cost, mirroring MLB's own documented pattern ("props cost scales per-game," `schema.prisma`'s `PlayerPropSnapshot` docstring) — not separately measured for NFL. |
| Storage/display licensing considerations | Not evaluated. |

## MLB game lines

| Category | Status |
|---|---|
| Existing stored data | Fully populated — `Game`, `OddsSnapshot`, `CurrentOddsLine`, `GameClosingLine`, `GameOutcome`, `PitcherSeasonStats`, `PlayerGameLog`, `LineupSlot` (`MLB-MODEL-INVENTORY.md` §4 data-lineage map). This is the most complete row in this table. |
| Free current data | MLB Stats API — schedule, scores, probable pitchers, boxscores, lineups, handedness. Unkeyed (`EDGE-BASELINE-AUDIT.md` §5). |
| Free historical data | Reconstructed from the same stored `Game`/`PlayerGameLog` history already ingested — no separate historical archive needed; the backtest reads the live tables' own accumulated history (`MLB-MODEL-INVENTORY.md` §5). |
| Paid/licensed current data | ParlayAPI/The Odds API — 15–21 events, 11 bettable books, Pinnacle present (`provider-coverage.md`) — the deepest coverage of any sport measured. |
| Paid/licensed historical data | `GameClosingLine` is captured going forward (`gradeOutcomes.ts`'s `captureClosingLine`) but is **written and never read** for MLB — no MLB CLV backtest exists yet (`MLB-MODEL-INVENTORY.md` §5, "a data-collection investment already made and entirely unused"). No separate paid historical odds archive beyond this repo's own accumulated `GameClosingLine` rows. |
| Credentials/environment variables | `PARLAY_API_KEY`/`ODDS_API_KEY`. |
| Rate limits/cost considerations | Free-tier `ODDS_API_KEY` documented as workable for dev/testing (`.env.example`); production-volume/Pinnacle-anchored pricing requires the paid `PARLAY_API_KEY` (`EDGE-BASELINE-AUDIT.md` §13). |
| Storage/display licensing considerations | Not evaluated. |

## MLB player props

| Category | Status |
|---|---|
| Existing stored data | Fully populated on the odds side (`PlayerPropSnapshot`, `CurrentPlayerPropLine`) and the outcomes side (`PlayerGameLog`, ~23,000 player-games per `MLB-MODEL-INVENTORY.md` §5). |
| Free current data | Boxscore-derived stat lines via MLB Stats API feed `PlayerGameLog` (free), which is what the Archer Prop Projection is validated against — but this is *outcomes*, not *odds*. |
| Free historical data | Same — `PlayerGameLog` history is free and already large. |
| Paid/licensed current data | ParlayAPI player-prop endpoint, already wired (`props/pollPlayerProps.ts`), gated by `PLAYER_PROPS_ODDS_ENABLED`. Measured at 58–75 MLB prop markets, 11 prop books (`provider-coverage.md`). |
| Paid/licensed historical data | **Confirmed gap, not just unverified:** `MLB-MODEL-INVENTORY.md` §5 states real historical prop odds don't exist in this dataset — `backtest-props-edge.ts` substitutes an assumed-vig proxy. Acquiring genuine historical prop odds would be a new, unbudgeted paid data source. **Requires provider evaluation.** |
| Credentials/environment variables | `PARLAY_API_KEY`, `PLAYER_PROPS_ODDS_ENABLED=true`. |
| Rate limits/cost considerations | Props are fetched via the per-event endpoint specifically because "props cost scales per-game" (`schema.prisma`'s `PlayerPropSnapshot` docstring) — a materially different cost shape than bulk game-odds polling. Not separately quantified here. |
| Storage/display licensing considerations | Not evaluated. |

## NBA / CBB (future game lines and props)

| Category | Status |
|---|---|
| Existing stored data | None. No `Sport` enum entry, no adapter, no tables. |
| Free current data | Not evaluated for this repo's purposes. **Requires provider evaluation** (an ESPN-style free scoreboard likely exists for both, following the pattern already used for NFL/CFB/tennis, but neither has been confirmed against this project's needs). |
| Free historical data | Not evaluated. **Requires provider evaluation.** |
| Paid/licensed current data | `provider-coverage.md` measured NBA on ParlayAPI already: 9–13 events, 1–6 bettable books, **no Pinnacle**, 1 scores row, 220–284 prop rows across 2 books, 19 prop markets — thinner than MLB/NFL on every axis, and explicitly grouped with UFC/tennis as *not* "deep coverage" in that doc's own conclusion ("Deep coverage (MLB, NFL, NBA)" — note: this doc's own July 2026 snapshot lists NBA under "deep coverage" in its summary paragraph despite the thinner numbers in the table; this inconsistency is called out here rather than silently resolved, since re-measuring near an NBA game night — the table's own stated caveat — was out of scope for this ledger). CBB was not measured at all. |
| Paid/licensed historical data | Not evaluated for either. **Requires provider evaluation.** |
| Credentials/environment variables | Would reuse `PARLAY_API_KEY`/`ODDS_API_KEY` if that provider is chosen; no NBA/CBB-specific key exists today. |
| Rate limits/cost considerations | Not evaluated. |
| Storage/display licensing considerations | Not evaluated. |

---

## Standing gaps (apply to every sport above)

1. **Storage/display licensing was not evaluated for any provider in this
   document.** Every row above marks it "not evaluated" rather than assuming
   either permissive or restrictive terms. Before persisting or publicly
   displaying any paid provider's historical odds at volume (which is exactly
   what the `ModelPrediction.marketSnapshot` field this task adds is designed
   to do), the provider's terms of service should be read for storage/
   redistribution restrictions — this repository's docs do not currently
   record having done that for ParlayAPI, The Odds API, OddsBlaze, or Cito.
2. **`provider-coverage.md`'s own numbers are explicitly volatile** ("a floor,
   not a measurement... re-run near game time before trusting them") — every
   figure cited from it above should be re-measured before being used to size
   a real integration decision, not treated as current fact.
3. **No provider capability, price, or rate limit in this document was
   invented.** Every "not evaluated"/"requires provider evaluation" marker
   above is a genuine gap in this repository's own record, not an oversight
   in writing this ledger.
