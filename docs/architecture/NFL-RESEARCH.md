# NFL research — experimental, signal-only Elo vertical slice

> `/nfl/research`. Isolated from `/nfl` (production line-shopping) and from
> `nflAdapter` (`src/lib/engine/adapters/nfl.ts`, whose `listPlays()` still
> returns `[]`, untouched). Read `docs/architecture/MODEL-PREDICTION-LIFECYCLE.md`
> before treating anything this page writes as more than a frozen research
> record.

## Purpose

Let the owner generate and preserve honest, point-in-time NFL win-probability
predictions for current games, using only free data, before any paid odds
integration or model-formula change. This is the same "start collecting the
thing v0 lacks — a track record" motivation as `docs/architecture/CFB-V0.md`,
applied to NFL's existing, already-validated Elo model instead of a new one.

## What this does

- Reads the current week's NFL schedule from ESPN's free, unkeyed scoreboard
  (`src/lib/nfl/research/espnSchedule.ts` — a client separate from
  production's `src/lib/nfl/espnScoreboard.ts`; see that file's docstring for
  why).
- Reconstructs each of the 32 teams' Elo rating strictly as of the current
  instant, by replaying nflverse's free historical game log
  (`src/lib/nfl/games.ts`'s existing `fetchNflGames`) through the EXISTING,
  unmodified `NflElo` class (`src/lib/nfl/elo.ts`) — the same math
  `npm run backtest:nfl` already validates. No formula, constant, or
  calibration threshold was changed to build this page.
- Displays, for every currently-scheduled (not yet started) game: kickoff
  time and status, both teams, model home/away win probability, expected
  home margin, each team's underlying Elo rating and games-played sample,
  and any missing-data/low-history warning.
- Lets the owner optionally type in a market line (moneylines, spreads, a
  "current"/"closing" label, a source label) that persists ONLY in the
  browser's `localStorage` — never sent to a server, never written to a
  database — for a transparent, side-by-side disagreement display. See
  "Manual lines are not evidence" below.
- On deliberate button click only, records a frozen snapshot of every
  currently-eligible game's prediction into the generic `PredictionRun`/
  `ModelPrediction` tables (see docs/architecture/
  MODEL-PREDICTION-LIFECYCLE.md), tagged `lifecycle: "experimental"`.

## What this does NOT do

- **No totals, no player props.** The Elo model has never produced either;
  this page doesn't invent them.
- **No spread-cover or over/under probability**, even when a manual spread
  is entered — there is no server-side market line to compute one against,
  and computing one against a self-reported, unverified browser value would
  misrepresent a fabricated number as a real market comparison. Only a plain
  point difference (model's expected margin vs. the market-implied margin)
  is shown.
- **No claim that expected margin is a validated spread edge**, and no claim
  that the model beats the market — the opposite is documented and true
  (see "The negative-CLV limitation" below).
- **No recommendations, units, stakes, or Kelly sizing** anywhere on this
  page or in anything it stores.
- **No Discord.** Nothing here posts anywhere.
- **No cron, no automatic polling.** The snapshot action fires only on a
  button click.
- **No change to `/nfl`**, `nflAdapter.listPlays()` (still `[]`), production
  model formulas, calibration thresholds, providers, or cron schedules.
- **No paid dependency.** Every data source below is free and unkeyed.
- **Does not persist manual browser lines as an authoritative market
  snapshot.** `ModelPrediction.marketSnapshot` is always absent for this
  model in this pass — see "Manual lines are not evidence" below.

## Free data sources

| Source | Used for | Cost |
|---|---|---|
| nflverse `nfldata/games.csv` (`src/lib/nfl/games.ts`, unchanged) | Elo reconstruction — every regular/postseason game since 1999 | Free, unkeyed |
| ESPN's public NFL scoreboard (`src/lib/nfl/research/espnSchedule.ts`) | Current week's schedule/status | Free, unkeyed |
| This project's configured `DATABASE_URL` | Prediction-history persistence only | Existing infrastructure, not a new dependency |

No `ODDS_API_KEY`, `PARLAY_API_KEY`, `ODDSBLAZE_API_KEY`, or any other paid
provider variable is read anywhere in `src/lib/nfl/research/` — confirmed by
grep, the same verification CFB's capture feature used.

## Explicit ESPN-to-nflverse team identity — a real bug found and fixed

`src/lib/nfl/research/teamIdentity.ts` resolves an ESPN display name to the
nflverse code that keys that team's Elo history — and does NOT assume
`NFL_TEAMS.abbreviation` (this codebase's own display convention,
`src/lib/nfl/teams.ts`) is that code. It isn't, for one team: **nflverse
codes the Los Angeles Rams as `"LA"`, never `"LAR"`.** This was found by
actually fetching nflverse's raw `games.csv` and diffing its observed codes
against `NFL_TEAMS`, not assumed — confirmed live 2026-09-21. Left
unhandled, every Rams prediction would have silently defaulted to an
"unrated" baseline forever, despite the Rams having decades of real history.

Beyond that one hand-fixed exception, every resolved identity is validated
against the ACTUALLY-fetched nflverse dataset (`validateNflverseCode`) — a
team whose resolved code never appears in the real data is excluded with an
explicit `unresolved-nflverse-identity` reason, never silently treated as
"zero games." Verified live: tonight's real Giants @ Rams game (2026-09-21)
correctly resolved the Rams to `LA` and showed 182 games played under that
code, against the Giants' 456 under their own continuous `NYG` code — which
is the next limitation, below.

## Known limitation: relocated-franchise history is not stitched together

nflverse codes a relocated franchise's eras separately, and this slice does
not merge them (nor does the underlying, unmodified `NflElo`/
`collectNflSamples`, which has always had this property — this page inherits
it, does not introduce it):

| Franchise | Historical code (seasons) | Current code (seasons) |
|---|---|---|
| Raiders | `OAK` (1999–2019) | `LV` (2020–present) |
| Chargers | `SD` (1999–2016) | `LAC` (2017–present) |
| Rams | `STL` (1999–2015) | `LA` (2016–present) |

A team's Elo rating and `gamesPlayed` count only reflect games under its
CURRENT code — confirmed by the real Rams number above (182, not the ~460 a
continuous 27-season history would show). This is a real, if second-order,
modeling limitation, not a bug this task fixes: correcting it would be a
formula/reconstruction change, out of this task's scope ("retain the
existing NFL model formula and constants exactly").

**Is the 182-vs-456 gap a material comparability problem for the RATING
itself, beyond the gamesPlayed count looking lopsided?** No, and this is
checkable directly from `NflElo.touch()`'s own reversion math
(`src/lib/nfl/elo.ts`), not just asserted: each new season, a team's
deviation from baseline is multiplied by `(1 − revert) = 2/3`
(`DEFAULT_NFL_ELO.revert = 1/3`). After *k* seasons, only `(2/3)^k` of a
given season's original signal survives into the current rating — e.g.
`(2/3)^10 ≈ 1.7%`. The Giants' pre-2016 (pre-Rams-relocation) history is
therefore ALREADY reverted to near-nothing in their 2026 rating regardless
of how many total games their unbroken `NYG` code counts — both teams'
CURRENT ratings are dominated by roughly the same recent handful of seasons
either way. The raw `gamesPlayed` disparity is a real, displayed fact (and
is exactly why it's shown), but it does not by itself mean the Rams'
rating is built on a materially thinner *effective* (recency-weighted)
sample than the Giants' — the low-history warning
(`homeLowHistory`/`awayLowHistory`, threshold `MIN_GAMES_FOR_SIGNAL = 8`)
correctly does not fire for either team, since both are far past the
sample-size regime that threshold exists to catch.

## The negative-CLV limitation

The underlying Elo model is **calibration-trusted** (`NFL_MODEL.calibration`
in `src/lib/nfl/model.ts`: Brier 0.2199 vs. base-rate 0.2292, n=6000) — its
stated probabilities roughly match realized frequencies. But
`npm run backtest:nfl:clv` (see `docs/architecture/calibration.md`'s "NFL
(biggest sport)") shows it **loses to the closing line**: −3.38% ATS
(2007–2025), −6.80% ATS (2019+), −7.97% moneyline ROI (2019+). This is why
every prediction this page shows or stores carries `lifecycle:
"experimental"`, an "experimental · signal-only" badge, and an inline
CLV-negative warning — never conditionally hidden, never described as a
proven edge.

## Manual lines are not evidence

Entries live only in the browser's `localStorage`
(`archer-nfl-research-market-v1`), keyed by ESPN event id, and are used only
for the page's own "model vs. market disagreement" display (a plain point
diff and a de-vigged win-probability diff — never a cover or O/U
probability, see `src/lib/nfl/research/manualMarket.ts`). `lineType`
("current"/"closing") and `source` are plain, self-reported, unverified
labels — the system never confirms a line genuinely was the closing number,
so nothing derived from a manual entry can be called CLV evidence. The
`ModelPrediction.marketSnapshot` field is always absent for this model in
this pass; wiring a real, server-visible market line is future work (see
below), not something this pass does quietly through the back door of a
browser-only field.

## How tonight's forward predictions can later be graded

The stored `ModelPrediction` rows already carry everything a future grading
pass needs: `eventRef` (ESPN event id), `scheduledStartUtc`, and the frozen
`homeWinProb`/`awayWinProb` pair. Grading requires only a NEW, separate
settlement record (not built in this task — mirrors CFB's own deferred
"future settlement record direction" in
`docs/architecture/MODEL-PREDICTION-LIFECYCLE.md`): once ESPN reports a
game final, a later job can look up the corresponding `ModelPrediction` rows
by `eventRef` and write a settlement row (final score, which side actually
won) WITHOUT touching the original, frozen prediction rows at all. This
page's own production sibling (`src/lib/nfl/results.ts`) already has a
working, tested ESPN-results pattern to build that job from — reuse, not a
new integration.

## Why one slate cannot establish validity

A single week's predictions — even if every one turns out correct — proves
nothing about calibration or CLV: the existing backtest already answers "is
this model honest" (yes, calibration-trusted) and "does it beat the market"
(no, confirmed CLV-negative, n in the thousands). One slate's outcomes are a
handful of correlated, small-sample data points (one week's games share
weather, byes, and news-cycle context) — nowhere near enough to move either
existing, well-powered verdict in either direction. The value of forward
collection is not "prove the model works in N games"; it's building an
honest, tamper-evident record that a future, much larger sample can be
evaluated against without anyone having to trust a retroactive
reconstruction.

## Future work required for a legitimate NFL totals model and player-prop model

Explicitly not attempted here, and not close to ready:

- **Totals.** No existing NFL totals model exists anywhere in this codebase
  (`src/lib/nfl/` has no total/point-total logic at all — only a
  margin-producing Elo). Building one would need its own historical
  backtest and its own CLV check against `total_line`/`over_odds`/
  `under_odds` (already present in `games.ts`'s parsed nflverse columns,
  unused today) before it could be shown as anything beyond a labeled
  research number — the same bar `MARGIN_SD`/`TOTAL_SD` cleared for CFB and
  Archer's runs/totals model, per `docs/architecture/calibration.md`.
- **Player props.** No player-level data source is wired for NFL anywhere in
  this codebase — no roster/snap/target data, no historical prop-odds
  source. `docs/architecture/MODEL-DATA-REQUIREMENTS.md`'s "Football player
  props" row already documents this gap: ParlayAPI measured NFL prop
  coverage exists at the provider level, but nothing here consumes it, and
  real historical prop ODDS (as opposed to outcomes) are a confirmed,
  unresolved gap even for MLB's own props backtest — the same caveat would
  apply here, likely worse (NFL props are even less commonly archived
  publicly than MLB's).
- **Relocated-franchise history stitching**, if ever judged worth the
  formula change (see "Known limitation" above) — would need its own
  backtest to confirm merging OAK→LV / SD→LAC / STL→LA histories actually
  improves calibration rather than importing stale, pre-relocation signal.

## Manual capture / how to use

Visit `/nfl/research`. The page itself is read-only until the "Record
prediction snapshot" button is clicked — no data is written on page load,
no cron exists. A second click for the same slate is blocked with a clear
message unless "Record anyway (new revision)" is explicitly chosen, which
writes an additional, independent, fully valid run rather than overwriting
the first (see `src/lib/nfl/research/captureSnapshot.ts`'s
`shouldBlockRerun` docstring for the same reasoning CFB's capture already
documents — no DB-level idempotency key exists, by deliberate choice, for
the same reason: no time-window bucket size is defensible without risking
either false blocks on legitimate later-in-the-week recaptures or missed
protection against a genuine fast double-click).
