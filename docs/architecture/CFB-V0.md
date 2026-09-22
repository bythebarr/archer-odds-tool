# CFB v0 — experimental college-football research board

> Shipped as a time-boxed vertical slice. Explicitly a research baseline, not
> a proven betting model. Read "Non-goals" before touching any number this
> page shows.
>
> **Adversarially reviewed 2026-09-19.** That pass found and fixed a real
> mathematical bug in the rating solver (see "Model formula" and "Review
> findings" below) — read that section before trusting any rating this model
> produced before the fix.

## Purpose

A first, honest look at college football inside ARCHR Edge: a free-data
schedule/results board plus a from-scratch, opponent-adjusted points model,
with a local (browser-only) market-line comparison so the owner can see how
the baseline stacks up against a real book's numbers without wiring a paid
odds feed. It exists to start collecting the thing v0 explicitly lacks —
a track record — not to make picks.

## Non-goals

- **Not a proven model.** Nothing here has been backtested against historical
  closing lines. Every constant in the model (`HOME_FIELD_POINTS`, `MARGIN_SD`,
  `TOTAL_SD`, the shrinkage strength) is a named, documented heuristic, not a
  fitted parameter.
- **Does not feed Discord, automated picks, staking, or Kelly sizing.** CFB v0
  is not registered in the sport engine (`src/lib/engine/registry.ts`) at all
  — it never touches the graded-play pipeline, the tracked ledger, or the
  card renderer.
- **No "best bet" language anywhere.** The board shows a projection and a
  market comparison, framed as research, never a recommendation.
- **No paid API, no scraping, no database.** See "Architecture" below.

## Architecture

CFB v0 has **zero Prisma involvement**: no `Sport` enum entry, no `Game`/
`Team` rows, no CFB-specific tables at all. This is a stronger isolation than
even F1 (which does have its own Prisma tables for race results) — the
schedule, results, and team ratings are fetched and computed fresh on every
request behind a short in-memory cache; nothing server-side persists between
requests except that cache.

The only persistence in the whole feature is the manually-entered market
lines, which live in `localStorage` in the owner's own browser
(`archer-cfb-market-v1`) and are never sent to a server or written to a
database.

Code lives under `src/lib/cfb/` (pure logic — types, the ESPN client, the
rating model, the prediction model, the manual-market validation/diff logic)
and `src/components/cfb/` + `src/app/cfb/page.tsx` (presentation, plus the
one file that actually touches `localStorage`,
`src/components/cfb/manualMarketStore.ts`).

### Navigation debt (temporary, v0-only)

`/cfb` is hand-appended as a fixed entry in `src/lib/nav.ts`'s `NAV_ITEMS`,
not derived from `SPORT_METAS`/the sport registry — so it's invisible to
every registry-driven surface (`SportRail`, the `/sports` lobby,
`HomeLauncher`). This is deliberate, documented debt, not an oversight:
**exit condition — CFB joins the registry only after a full
adapter/storage/grading strategy for it is approved**, not before, since the
registry pulls in Prisma types and the graded-play pipeline (Discord, the
ledger, Kelly sizing) that CFB v0 must not touch.

## Data source

ESPN's public college-football scoreboard:
`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard`
— free, unkeyed, read-only. Same provider and role as NFL's results authority
(`nfl/espnScoreboard.ts`), given its own client (`cfb/espnScoreboard.ts`)
rather than reused directly, because CFB's payload needs fields NFL's client
doesn't parse (neutral-site flag, team records) and — importantly — is **not**
filtered through an NFL-style team allowlist. ESPN's own numeric team `id` is
the join key across ~130 FBS teams; `groups=80` scopes every request to FBS.

Two query shapes, same endpoint:
- `?dates=YYYYMMDD&groups=80` — one day's full slate (the board's daily view).
- `?year=&week=&seasontype=2&groups=80` — one week's full slate (used to
  gather the season's completed games for the rating model).

## Model formula

**Ratings** (`src/lib/cfb/ratings.ts`, `buildTeamRatings`): an iterative,
opponent-adjusted offense/defense solver in the SRS (simple rating system)
family.

1. Compute the season-to-date league-average points per team-game
   (`leagueAvgPoints`), from every completed game before the as-of cutoff.
2. For each game, strip home-field before rating: a non-neutral home score is
   reduced by `HOME_FIELD_POINTS / 2` and the away score increased by the same
   amount (and vice versa for points allowed), so ratings measure team
   strength independent of where the game was played. Neutral-site games are
   left untouched.
3. Run a fixed number of rounds (`SRS_ITERATIONS = 30`, deterministic — no
   convergence-epsilon judgment call) of **Gauss-Seidel** updates (each team's
   new value is written in place and immediately visible to the rest of the
   same round — needed for reasonable convergence speed on a sparse graph):
   `offenseRating[team] = avg over games of (netPointsFor − defenseRating[opponent])`
   `defenseRating[team] = avg over games of (netPointsAgainst − offenseRating[opponent])`
   **followed every round by recentering each connected component of the
   schedule graph to its own zero-mean offense** — see "Review findings"
   below for why this step is load-bearing, not cosmetic.
4. Shrink both ratings toward 0 (each component's own average) by sample size:
   `shrunk = raw × gamesPlayed / (gamesPlayed + SHRINK_GAMES)`, with
   `SHRINK_GAMES = 4`. A 1-game team keeps ~20% of its raw rating; an 8-game
   team keeps ~67%.
5. `netRating = offenseRating − defenseRating`. Strength of schedule is the
   average (shrunk) net rating of the opponents actually faced.

**As-of cutoff**: enforced *inside* `buildTeamRatings` itself (re-filters to
`game.startUtc < asOfUtc`), not just trusted of the caller — a target game's
own result, or any later game, can never leak into its own prediction's
ratings. The page uses one shared cutoff (the start of the browsed ET day) for
every game shown that day, which is stricter than "before this specific game's
own kickoff" but simpler and still fully leakage-safe. `buildTeamRatings` also
defensively deduplicates by ESPN event id (so does the schedule-collection
layer, `fetchCfbSeasonThrough` — belt and suspenders).

**Prediction** (`src/lib/cfb/model.ts`, `predictGame`):

```
projectedHomeScore = max(0, leagueAvgPoints + offense[home] + defense[away] + hfaSplit)
projectedAwayScore = max(0, leagueAvgPoints + offense[away] + defense[home] − hfaSplit)
  where hfaSplit = neutralSite ? 0 : HOME_FIELD_POINTS / 2
projectedMargin = projectedHomeScore − projectedAwayScore
projectedTotal  = projectedHomeScore + projectedAwayScore
homeWinProb     = normalCdf(projectedMargin, MARGIN_SD)
awayWinProb     = 1 − homeWinProb   (never computed independently — always sums to exactly 1)
```

Confidence is a qualitative label (`low` / `medium` / `high`) driven by the
lesser-sampled team's `gamesPlayed`, below/above `MIN_GAMES_LOW_CONFIDENCE = 3`
and `MIN_GAMES_HIGH_CONFIDENCE = 6`. A `low`-confidence prediction now also
shows an explicit inline warning on the page itself (not just the small
confidence badge) — see "Review findings" below.

**Spread-cover and over/under probabilities** (`spreadCoverProbability`,
`totalOverProbability`, also in `model.ts`, added during the adversarial
review — v0's original scope covered only margin/total/win-probability, not
these): the same normal-distribution assumption as the win-probability model,
applied against a *manually entered* line rather than the model's own
projection.

```
homeCoverProb = 1 − normalCdf(−homeSpread − projectedMargin, MARGIN_SD)
awayCoverProb = 1 − homeCoverProb   (always sums to exactly 1)
overProb      = 1 − normalCdf(marketTotal − projectedTotal, TOTAL_SD)
underProb     = 1 − overProb        (always sums to exactly 1)
```

Only computed when the corresponding manual line is entered — a missing
spread or total never produces a fabricated probability (`null` instead).
Labeled "experimental" everywhere they're displayed; never used to compute EV
or a stake size. A continuous normal distribution has zero probability mass
at any single point, so a push (landing exactly on the line) reads as
vanishingly unlikely rather than being modeled explicitly — an honest
simplification of a real, if rare, outcome for an integer-valued line, not a
claim that pushes can't happen.

## Heuristic constants (none are calibrated)

| Constant | Value | Where | Status |
|---|---|---|---|
| `HOME_FIELD_POINTS` | 2 | `model.ts` | Heuristic — modern-era HFA estimate, same rationale as `nfl/elo.ts`'s HFA constant. Not fit to CFB history. |
| `MARGIN_SD` | 17 | `model.ts` | Heuristic — a commonly-cited rough figure for CFB game-margin spread. Not fit to this model's own results. |
| `TOTAL_SD` | 16 | `model.ts` | Heuristic, same spirit as `MARGIN_SD` but a separate constant — a total's variance isn't the same quantity as a margin's. Not fit to history. |
| `SRS_ITERATIONS` | 30 (was 15) | `ratings.ts` | Fixed round count for determinism. Bumped during review for a comfortable safety margin — order-shuffle residual was already ~3e-5 at 15 rounds and ~1e-15 (float noise) by 30, on a graph considerably sparser than a real FBS slate. |
| `SHRINK_GAMES` | 4 | `ratings.ts` | Heuristic shrinkage strength. Not fit to observed early-season rating variance. |
| `DEFAULT_LEAGUE_AVG_POINTS` | 27 | `ratings.ts` | Fallback only, used before any games exist to average. |
| `MAX_PLAUSIBLE_SCORE` | 120 | `espnScoreboard.ts` + `ratings.ts` | Added during review — a completed game with either score above this is rejected at parse time rather than let it dominate a rating unnoticed. Generous relative to the real FBS single-game scoring record (low 90s). |

## Review findings (adversarial review, 2026-09-19)

**Blocker found and fixed — rating solver was order-dependent.** The coupled
offense/defense equations
(`offense[t] = avg(netPointsFor − defense[opponent])`,
`defense[t] = avg(netPointsAgainst − offense[opponent])`) are invariant under
the shift `(offense[t] += c, defense[t] −= c)` for every team in a connected
component, for any constant `c` — a real, provable free parameter, not a
convergence-speed issue. Confirmed empirically: shuffling the input games'
order moved net ratings by up to ~6.7 points on a 10-team/20-game test graph,
*unchanged* whether Gauss-Seidel ran 15, 60, or 500 rounds (i.e. it converges
fast, just to a different point in a one-parameter family depending on visit
order). Fixed by recentering each connected component's own mean offense to 0
after every round, pinning the free constant — re-verified: order-shuffle
residual is ~1e-15 (float noise) at 30 iterations, for both a connected and a
genuinely disconnected test graph. See `ratings.ts`'s module docstring and
`ratings.test.ts`'s "order independence"/"convergence" tests for the full
proof. **The solver was retained, not replaced** — a single-variable net-only
SRS has the identical uniform-shift degeneracy (verified before choosing the
fix), so recentering was the correct, minimal, order-independent fix rather
than a different algorithm; no ML dependency was introduced.

**Known, smaller residual limitation (same review, not fixed):**
`leagueAvgPoints` is one number shared across the whole input, not computed
per connected component. Per-component recentering guarantees each
component's *offense* ratings are exactly independent of every other
component's results (test-verified) — but a change to a disconnected
component's scores still nudges the shared `leagueAvgPoints`, which very
slightly shifts every *other* component's *defense* (and therefore net)
rating's absolute level, without changing any team's rank relative to its own
component-mates. Measured: ~0.17 points of movement on a graph where real
signal ran ~±30. Left as v0 scope rather than engineered around — a genuinely
per-component league average raises its own ambiguity for projecting an
upcoming *cross-component* matchup, the one case where it would matter most.

**Other fixes made during this review:**
- **Deduplication.** `CfbCompletedGame` now carries `espnEventId`;
  `buildTeamRatings` and `fetchCfbSeasonThrough` both independently reject a
  repeated event id, so the same game can never double-count.
- **Implausible-score guard.** A completed game with either score above
  `MAX_PLAUSIBLE_SCORE` (120) is rejected at ESPN-parse time, so one feed
  glitch can't silently dominate a rating.
- **Request-integrity validation.** `toEspnDateParam` and `fetchCfbWeek` now
  validate their inputs (date shape; season/week as bounded integers) before
  building a request URL — defense in depth, since the host is always the
  hardcoded ESPN URL regardless, but a malformed input could otherwise inject
  characters into the query string.
- **Cache bound.** The in-memory ESPN response cache now caps its entry count
  (200) with oldest-first eviction, so a long-lived server process can't grow
  it without bound.
- **Duplicate/invalid HTML ids.** The manual-line inputs previously derived
  their `id` from the team abbreviation + field label — when ESPN doesn't
  supply an abbreviation (falls back to the literal "Home"/"Away"), every such
  game's inputs on the page collided on the same id, which is invalid HTML and
  breaks the label/input association for assistive tech. Fixed: every input's
  id now incorporates the game's ESPN event id, guaranteed unique page-wide.
- **Live/final games no longer read as a current live prediction.** The
  projection block now labels itself "Pregame model projection" (with an
  explicit note) once a game is live or final, instead of looking identical
  to a still-to-be-played game's forecast.
- **Low-confidence predictions get more than a small badge.** A `low`
  confidence rating now also renders a visible inline warning sentence next
  to the win probabilities, naming the actual sample size — not just the
  small confidence badge, and not a fabricated statistical confidence
  interval (none exists to fit).
- **Upstream-failure handling.** `/cfb` previously had no `try/catch` around
  its ESPN fetches — an outage would crash into Next's generic error page.
  It now renders an honest "couldn't load" empty-state instead, and never
  fabricates a slate on failure.
- **Spread-cover and over/under probabilities added** — see "Model formula"
  above. The original v0 scope stopped at margin/total/win-probability;
  section D of the review explicitly asked for these against the manually
  entered line, so they were added as pure, tested, clearly-labeled
  experimental functions.

**Reviewed and found acceptable, not changed:**
- CFB's mobile `BottomNav` slot (added per an earlier explicit product
  decision) brings the primary tab count to 7 — denser than before, but each
  label is short (parity with "MLB"/"UFC") and the bar remains usable, just
  tighter. Not re-litigated here since it was a deliberate, informed choice.
- Existing site-wide "every sport" copy (the `/sports` lobby, `SportRail`,
  the meta description) refers to the priced/graded sport product, which CFB
  explicitly is not — not a false exhaustivity claim, just a scope boundary
  CFB sits outside of by design.
- FCS/unrated "buy game" opponents are not filtered or specially flagged;
  they're handled the same as any other single-game team (heavy shrinkage
  toward league average). Verified this doesn't explode or produce
  non-finite output (`ratings.test.ts`), but the model has no explicit
  "this is a mismatch" signal beyond what shrinkage already provides.

## Manual market workflow

Because no CFB odds provider is wired (no paid API, no scraping), the owner
types a book's numbers in by hand, per game: home spread, market total, home
moneyline, away moneyline. Entries:

- Persist only in `localStorage`, keyed by ESPN event id — never sent to a
  server, never written to a database. Because the key is the event id (not,
  say, a team-name pair), an old saved line can't silently reattach to a
  different game in a future season the way a name-based key might.
- Are validated on entry (`src/lib/cfb/manualMarket.ts`): American odds must
  be an integer at or beyond ±100 (0 and the open range between −100 and +100
  are rejected); spreads/totals must be finite (NaN/Infinity rejected)
  numbers within a sane range.
- Are compared against the model, never blended into it: spread/total diffs
  in points, experimental spread-cover and over/under probabilities (see
  "Model formula"), and — only when both moneylines are entered — a two-sided
  de-vig (`@/lib/odds/devig.ts`'s `devigPair`, the same proportional-devig
  method used elsewhere in the app) to get a market-implied win probability to
  diff against the model's.
- Never produce a staking unit or a Kelly size.
- Have a per-game "Clear" control; nothing here needs a global reset since
  each game's entry is independent.
- The actual `localStorage` I/O lives only in
  `src/components/cfb/manualMarketStore.ts` (a client component file) — no
  server-rendered file in `src/app/cfb` or `src/lib/cfb` ever touches
  `window`/`localStorage`, and that file's `useSyncExternalStore` snapshot
  returns a fixed empty store on the server, matching what a fresh client
  render sees before hydration (the same pattern `src/lib/slip/SlipContext.tsx`
  already uses), so there's no hydration mismatch.

## Forward-prediction capture (manual, append-only — separate from the live board)

The board above (`/cfb`) still computes and discards on every request, exactly
as described in "Architecture" — nothing about it changed. A **separate,
optional** path now exists to durably preserve CFB v0's predictions ahead of
kickoff, so a real, honest track record can start accumulating before any new
model feature is added. See `docs/architecture/MODEL-PREDICTION-LIFECYCLE.md`
for the full generic design; this section covers CFB's specific use of it.

**What's stored.** `src/lib/cfb/predictionCapture.ts` is a pure function
(no Prisma, no network) that turns an already-fetched slate plus an
already-built `CfbRatingBook` into a `PredictionRunInput` (see
`src/lib/predictions/types.ts`). For every eligible game it writes **two**
`ModelPrediction` rows — `selectionKey: "home"` and `"away"`, both under
`marketKey: "h2h"` — carrying:

- the model's win probability for that side (the pair always sums to 1)
- the full game-level projection (`projectedHomeScore/AwayScore/Margin/Total`,
  `confidence`, `minGamesPlayed`) — identical on both rows, deliberately
  duplicated so one row is self-contained; **do not count "games predicted"
  by counting rows** — two rows share one game, count distinct
  `(eventRef, marketKey)` pairs instead
- the exact feature snapshot: ESPN event id, scheduled start, neutral-site
  flag, league-average points, both teams' full ratings (offense/defense/net/
  games played/SOS), the home-field points actually applied, the data-as-of
  cutoff, and every named heuristic constant from "Heuristic constants" below
  needed to reproduce the number
- which side(s), if any, had no prior rating (`homeTeamUnrated`/
  `awayTeamUnrated`) — the only "missing input" v0's own feature schema can
  legitimately report; weather/injuries/recruiting/coaching are never
  reported missing, since they're not part of v0's declared inputs yet

**No market line is ever stored or fabricated.** CFB has no server-side odds
feed (see "Manual market workflow" above — lines live only in the owner's own
browser). `marketSnapshot` is always absent, and no spread-cover or
over/under probability is computed or stored, because there's no known line
to compute one against — doing so would misrepresent a fabricated number as a
real market comparison. `projectedMargin`/`projectedTotal` ARE preserved, as
plain model output values, never paired with a probability.

**Model identity** (`src/lib/cfb/modelIdentity.ts`): `modelKey: "cfb-srs"`,
`modelVersion: "v0.1.0"`, `lifecycle: "experimental"` — hand-bumped, never
derived from a git commit (a commit SHA identifies a checkout, not "which
version of this specific model" — see that file's own docstring). Never
`validated` or `production` until this model has actually cleared that bar
(see "Validation plan" below).

**How to run it.** Manual only — no cron, no schedule, per this feature's own
scope:

```
npm run capture:cfb:predictions                          # today, ET
npm run capture:cfb:predictions -- --date=2026-09-27      # a specific future date
npm run capture:cfb:predictions -- --date=2026-09-27 --confirm-rerun
```

Requires only `DATABASE_URL` (this project's existing Postgres) — the free,
unkeyed ESPN endpoint is the only network call. No paid provider, no new API
key, no live odds integration. Prints the model identity, `generatedAt`/
`dataAsOfUtc`, eligible-game count, exclusions by reason, the run id, and
rows written; exits nonzero on a provider/validation/database error, and
exits 0 with a truthful "nothing eligible" message on a genuinely empty or
fully-excluded slate (it never writes an empty `PredictionRun`).

**Temporal integrity.** Only `"scheduled"`-status games whose kickoff is
strictly after the capture's `generatedAt` are eligible — live, final,
postponed, and unrecognized-status games are excluded and counted by reason,
as is any nominally-scheduled game whose kickoff has already passed. Ratings
come from a separately-fetched, separately-cutoff-bounded completed-games
list, so a target game's own result can never leak into its own prediction.

**As-of cutoff: same mechanism as `/cfb`, a deliberately different value.**
Capture calls the identical `buildTeamRatings`/`predictGame`/`ratingOrDefault`
functions the live board uses — same constants, same rating defaults, same
strict-`<`-before-cutoff enforcement inside `buildTeamRatings` itself (see
`ratings.test.ts`'s "enforces a strict as-of cutoff", and
`predictionCapture.test.ts`'s "live-page parity" block, which proves this by
running both paths over identical inputs and asserting byte-identical
output). What's NOT the same, on purpose: the live page pins `asOfUtc` to
"start of the BROWSED date" — one shared, display-convenient cutoff for
every game shown that day, regardless of when you're actually viewing it
(see `page.tsx`'s own comment). Capture instead uses "the actual instant the
script ran." Pinning capture to "start of the target date" would let a
prediction generated days in advance implicitly see information that didn't
exist yet when it actually ran — a real causality violation, not a harmless
display simplification. `dataAsOfUtc`, as stored, is always exactly the
value `buildTeamRatings` was actually called with — never a separately
re-derived approximation, and never claimed to be stricter than it is.

**Retry protection — a deliberate, documented limitation, not a schema
change.** There is no database-level idempotency key for "one CFB capture
attempt." Before writing, the script checks whether this exact model/version
already produced a prediction for a game inside the target date; if so, it
refuses and requires an explicit `--confirm-rerun` to proceed as a new,
additional revision. This is a soft, human-confirmed gate, not an enforced
constraint — a confirmed rerun writes a normal, fully valid additional run,
and nothing about the storage layer's own ability to hold legitimate
revisions is weakened. See `src/lib/cfb/capturePredictions.ts`'s
`shouldBlockRerun` docstring for why a hard, automatic key was deliberately
not built (any time-bucket size would be an arbitrary line between "retry"
and "legitimate same-day revision"). **Honest scope:** the check queries the
real, shared database, so it correctly catches a retry after an EARLIER
process has already finished (including from another machine) — but the
check-then-write is not atomic, so two invocations running at the literal
same instant could both pass the check before either writes. Accepted, not
fixed: this is a manual, single-operator CLI, never a cron or a multi-worker
job.

**No Discord, no production eligibility.** This writes only to
`PredictionRun`/`ModelPrediction`. Nothing reads these tables yet — the board,
the sport registry, Discord, and the card/deck pipeline are completely
untouched, exactly as before this feature existed.

## Missing factors (known, not yet incorporated)

Injuries and player availability, weather, transfers/returning production,
coordinator changes, detailed matchup data, AP/CFP rankings, recruiting/talent
composite, pace/tempo, and any line-play or explosive-play detail. The model
is points-scored/allowed only.

## Validation plan

None of this has been validated yet — that's the point of calling it v0.
Before any number here is described as calibrated:

1. Backtest projected margins/totals and win probabilities against a full
   multi-season history (see roadmap item 1–3 below).
2. Compare the model's calibration (Brier score vs. base rate) the same way
   `nfl/model.ts`'s `collectNflSamples` does for NFL Elo.
3. Compare against closing lines specifically (CLV), the same bar every other
   sport's model is held to before being called signal (see
   `docs/architecture/calibration.md`).

**What forward capture (above) changes about this plan, precisely:**

- **Now possible:** honest, point-in-time **outcome** calibration — once
  enough `ModelPrediction` rows exist and a settlement record is built (see
  `MODEL-PREDICTION-LIFECYCLE.md`'s "future settlement record direction"),
  the model's win-probability calls can be scored against real final
  outcomes the same way `calibration.ts` scores every other sport, without
  any lookahead risk, because the prediction was frozen before kickoff.
- **Still blocked:** CLV and spread/total-market evaluation (item 3 above,
  and any spread-cover/over-under calibration) — those require real,
  point-in-time market lines, and CFB v0 collects none server-side (see
  "Forward-prediction capture" above and `docs/architecture/
  MODEL-DATA-REQUIREMENTS.md`'s CFB row). Nothing changes here until a real
  market-line source is evaluated and wired.
- This plan's numbered steps 1–3 are unchanged and still describe the
  eventual bar; forward capture is what makes step 1's *live* half honestly
  collectible starting now, not a replacement for the historical backtest.

## Upgrade roadmap

1. Historical multi-season backfill
2. Walk-forward calibration
3. Closing-line comparison
4. Weather
5. Injuries and player availability
6. Returning production and transfers
7. Quarterback-specific modeling
8. Offensive/defensive efficiency
9. Line play and pressure
10. Explosive plays
11. Pace
12. Coordinator tendencies
13. Player props
