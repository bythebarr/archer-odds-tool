# NFL adapter — what it needs

> **Phase 1 shipped 2026-07-21** (feed + line shopping). Registered adapter,
> odds poll, `/nfl` board and game pages, Slate presence. `signalOnly` until a
> results source lands. What was actually learned doing it is in "Phase 1 as
> built" at the bottom — read that before phase 2.

Sketch, not a commitment. Written 2026-07-21 off the coverage audit
(`provider-coverage.md`), which found NFL already carrying 11 bettable books,
Pinnacle, and 67–82 prop markets on a provider we're paying nothing for.

## Why NFL and not tennis

Tennis has been the next-sport assumption for a while. The audit says that's
backwards: tennis has **zero props and zero scores** on this provider, while NFL
has more prop markets than MLB. NFL is also the largest betting market in the
US by volume, and it's the one where recreational books hang the most beatable
numbers.

The catch worth naming up front: **it's July.** Everything below is verifiable
now, but real book depth won't show until preseason. Build against the shape,
re-run the audit in September before promising anything to members.

## What already exists (most of it)

The sport engine is deliberately provider- and sport-agnostic, so an NFL adapter
is mostly wiring, not new machinery:

- `SportAdapter` contract — `src/lib/engine/types.ts:200`. Required: `key`,
  `meta`, `ingest`, `listPlays`, `grade`, `markets`. Optional: `refresh`,
  `model`, `props`.
- `fetchOdds(sportKey, markets, regions)` — `src/lib/odds/oddsApiClient.ts`
  already takes any sport key. NFL needs no new client.
- `fetchBulkPlayerProps(sportKey)` — same, already generic.
- Book allowlist, de-vig consensus, best-price selection, Kelly sizing, the
  Discord card renderer, the Slate — all sport-neutral already.
- Calibration + CLV harness — `docs/architecture/calibration.md`.

The leanest existing adapter is `src/lib/engine/adapters/soccer.ts` (49 lines:
meta, a real `ingest`, an empty board, a conservative `grade`). That's the
correct shape for phase 1 — ship the feed before the model.

## What's genuinely new

**1. Schedule + results source.** This is the real work, and the audit is why:
Parlay's `/scores` exists for NFL (16 events) but its event ids **do not
reliably match `/odds`** — 12 of 16 agreed, 4 didn't. Same partial-agreement
trap that made props write zero rows for a day. So:

- Do **not** join on `event_id`. Reuse the team-name matcher pattern in
  `src/lib/props/eventMatch.ts`.
- Prefer a free authoritative schedule/results source the way MLB uses MLB Stats
  API, rather than depending on Parlay `/scores` at all. ESPN's public NFL
  scoreboard endpoint is the usual candidate — needs verifying, not assuming.

**2. Team table.** `Team` (`prisma/schema.prisma:63`) is currently MLB-shaped
(`mlbTeamId`, `league`, `division`). NFL teams need either a `sport` discriminator
on `Team` or a separate table. Cheapest honest option: add `sport` to `Team` and
make `mlbTeamId` one of several optional external ids.

**3. Markets.** NFL's spine is spreads and totals, not moneyline — the opposite
weighting to MLB. `MarketSpec` already covers all three; it's the *model* that
would need different priors, which is exactly why phase 1 ships without one.

**4. Props vocabulary.** NFL prop keys (`player_pass_yds`, `player_rush_yds`,
`player_receptions`, …) need the same treatment `propMarkets.ts` gave MLB: an
allowlist mapping Parlay's keys to gradeable categories, plus a `StatCategory`
expansion. Expect the same two traps:
  - ambiguous keys that mix positions (the `player_strikeouts` equivalent)
  - `*_alt` milestone ladders needing the "N or more = Over (N − 0.5)" shift

## Suggested phasing

1. **Feed only** — team table, schedule/results ingest, odds polling, a
   soccer-shaped adapter with an empty board. Proves the data before any claim.
2. **Line shopping** — surface NFL on the Slate with best-price across books. No
   model, no EV. This is already sellable and rests on nothing unproven.
3. **Props** — market vocabulary, hit-rate backfill, prop board. Where the edge
   actually is, per the calibration work.
4. **Model EV** — only after a CLV backtest says the model beats the close. MLB
   sides/totals didn't (`docs/architecture/calibration.md`); assume NFL won't
   either until measured.

Steps 1–3 need no model and carry no honesty risk. Step 4 is the one that has
burned this project before.

## Before starting

Re-run `npx tsx scripts/odds/audit-coverage.ts` in preseason. If NFL book depth
doesn't hold above single digits once games are live, phase 2 isn't worth
shipping and this plan should be reconsidered rather than followed.

## Phase 1 as built (2026-07-21)

Measured on the first live poll: **38 events, 394 snapshots, 6 credits.**

**The feed carries CFL games under the NFL sport key.** Not anticipated above,
and the most important thing learned. `americanfootball_nfl` returned Edmonton
Elks, Saskatchewan Roughriders, Calgary Stampeders, Winnipeg Blue Bombers,
Toronto Argonauts, BC Lions, Hamilton Tiger-Cats, and Montreal Alouettes —
Canadian football, different scoring, different sport. Nothing in the response
distinguishes them; the sport key is simply wrong.

The fix is `src/lib/nfl/teams.ts`: a closed 32-team allowlist, matched on a
normalized name, that both filters the feed and supplies real abbreviations,
conferences, and divisions. Unrecognized competitors are skipped **and named in
the poll log**, because that line has two meanings — expected CFL clubs, or a
real NFL team whose name drifted past the allowlist, which would silently cost
games. This reverses the doc's earlier call against a 32-row constant: the
alternative turned out to be storing another league as NFL.

Synthesized abbreviations were also a mistake worth recording — first-letter
initials produced `C` for Carolina, Chicago, Cincinnati *and* Cleveland, and `NY`
for both the Giants and the Jets. The allowlist removed the whole class.

**Book depth held up.** A Week 1 game (BAL @ IND) priced across 10 books
including Pinnacle, with the away moneyline ranging −184 (Pinnacle) to −210
(Parx) — a 26-cent spread on one side of one game. That is the line-shopping
thesis behaving exactly as the coverage audit predicted, in the off-season.

**Spreads are thin in July, as expected**: 6 spread rows against 22 total rows
across 34 games. Not a bug — books haven't hung the numbers yet. The board leads
with the spread and falls back to the moneyline per game, so this degrades
cleanly. Re-check in preseason before drawing any conclusion from it.

## Phase 2 as built (2026-07-21): NFL is tracked

**ESPN's public scoreboard is the results authority** — free, unkeyed, and
verified live against a completed 2025 slate: full team display names matching
our allowlist exactly, final scores, and an explicit per-team `winner` flag. It
sits in the same role MLB Stats API plays for baseball, Cito for UFC, Jolpica for
F1. `signalOnly` is cleared; NFL grades like MLB.

Matching is on **normalized team names plus ET date** — never an id (the
provider's own ids agree across its endpoints on only 12 of 16 NFL games) and
never a raw UTC clock (the odds feed is 6h early for every game starting at or
after 00:00 UTC; see `src/lib/odds/ingest.ts`). ET date is the one key both
sources agree on.

`gradeGame` was generalised rather than duplicated: spread and total grading is
arithmetic on a final score, so NFL reuses MLB's unchanged. The one real
difference is that **an NFL game can end tied**, which pushes the moneyline —
grading a tie as a loss for both sides would understate the record on exactly
the games people remember.

End-to-end verified: 10 of 10 real completed games finalized and graded, winners
correct. Results that match no Game row are counted and named in the summary
rather than dropped silently — the failure mode that let tennis report "ok" for
weeks while grading nothing.

### What's left

- **Props** — the market vocabulary and hit-rate backfill (step 3 above). This is
  where the calibration work says the edge actually is, and NFL carries more prop
  markets than MLB. Now the clear next step — see "Phase 4 attempted" below.
- **Alt-line ladders** — not a phase-2 gap but a provider one: ParlayAPI rejects
  `alternate_spreads`/`alternate_totals` outright, so the ladder needs a second
  odds source, not more code.
- **Model EV** — attempted twice now (Elo, then SRS), both CLV-negative. Not
  ruled out forever, but there's no third candidate queued — see below.

## Phase 4 attempted (2026-09-22): SRS model, also CLV-negative

A second, structurally different model was built and honestly backtested
against real nflverse closing-line history — not a variant of the existing
Elo model, but an opponent-adjusted points model (offense/defense SRS,
mirroring `src/lib/cfb/`'s architecture 1:1: same Gauss-Seidel solver, same
per-component recentering identifiability fix, same `predictGame`/
`spreadCoverProbability`/`totalOverProbability` shape). Code lives in
`src/lib/nfl/srs/`, not imported by any production path.

Unlike CFB (no real market data to fit against at all), NFL's free nflverse
feed (`src/lib/nfl/games.ts`) carries real closing spread/total/moneyline in
the same rows as results, so — unlike CFB's admittedly-unfit placeholder
constants — this model's `HOME_FIELD_POINTS`/`MARGIN_SD`/`TOTAL_SD` were
genuinely *fit*: walk-forward, 70/30 chronological train/validate split,
nflverse 2007+, ratings rebuilt once per NFL week (lookahead-safe — each
week's cutoff is that week's own earliest kickoff).

**Result** (`npm run backtest:nfl:srs`, n=4,951 graded games):

- OOS calibration is honest: Brier 0.2456 vs. a base-rate guess's 0.2488 —
  real, if modest, discrimination.
- **CLV-negative on both markets**: ATS −3.48% ROI (vs. a flat-favorite
  −5.98% baseline — better than doing nothing, still a clear loser against
  the close) and moneyline **−9.36%** ROI (worse than a flat "always bet the
  favorite" baseline's −2.68%).
- The ATS edge-bucket breakdown is non-monotone (1-2pt −2.25%, 2-3pt −2.26%,
  3-5pt −8.07%, 5+pt −1.62%) — no "bigger edge, better ROI" gradient, the
  same real-signal check every other wired term in this codebase passes and
  this one fails.
- Directly comparable to (not meaningfully better than, and worse than on
  moneyline) the existing Elo model's own result: ATS −3.38% to −6.80%, ML
  −7.97% (`npm run backtest:nfl:clv`).

**Verdict: not wired**, same as Elo. `nflAdapter.listPlays()` stays `[]`. Two
structurally different, honestly-fit models have now independently reached
the same negative answer on NFL game lines — that's a real finding, not a
build-quality problem: it's consistent with this doc's own step 3/4 ordering
("props... is where the calibration work says the edge actually is") and
with MLB's own calibration history (sides/totals also don't clear the CLV
bar there). Code kept, not deleted, same posture as MLB's disabled
bullpen-fatigue term — sound infrastructure a future feature set (QB status,
injuries, rest) could still build on, just not today's answer.

## Phase 5 attempted (2026-09-22): richer game-context signals, still no real signal

Before writing off game lines entirely, five more candidate signals were
investigated on top of the SRS baseline above — the "cheap," already-fetched
half of a much longer brainstormed list (weather, rest, schedule spot,
division familiarity, strength-of-schedule; the harder half — offensive
run/pass tendency and defensive scheme fit — needs nflverse's much bigger
play-by-play files and a real CSV parser this repo doesn't have yet, and
wasn't attempted this round; see "Not attempted" below). `src/lib/nfl/games.ts`
already had these columns unread (`roof`/`temp`/`wind`, `weekday`/`gametime`,
`away_rest`/`home_rest`, `div_game`) — now parsed. Investigation script:
`npm run matchup:nfl:context`, same walk-forward replay as `backtest-nfl-srs.ts`
(factored into shared `srs/backtestHarness.ts` so both scripts share one
lookahead-safe pass), same train-fit/validate-check bar as MLB's props studies.

**Result** (n=3,465 train / 1,486 validate):

| Candidate | Target | OOS residual-variance reduction | Verdict |
|---|---|---|---|
| Temperature (outdoors only) | total | 0.38% | Real direction (monotone tercile gradient, hotter = more scoring — same physical hypothesis as MLB's weather feature), but negligible magnitude. |
| Wind speed (outdoors only, no direction data in nflverse) | total | 0.94% | Same story — monotone, physically sensible (more wind → less scoring), still under 1%. The strongest of the five, and still far too small to matter. |
| Rest advantage (home rest − away rest) | margin | 0.22% | Negligible. |
| Strength-of-schedule differential | margin | **−0.72% (OOS worse than baseline)** | Fits in-sample (0.43% train reduction) then makes it WORSE out of sample — classic overfit-to-train-noise, not a real effect. |
| Schedule spot (weekday) | margin & total | n/a (categorical) | Thursday (n=102) shows a suggestively large total-residual bump (+2.17), but every non-Sunday bucket is thin (Saturday n=47, Friday n=6, Wednesday n=4) — not separable from noise at this sample size. |
| Division familiarity (div_game) | margin & total | n/a | The "division games run closer" belief isn't supported: mean \|actual margin\| is 11.19 (div) vs. 11.20 (non-div) — essentially identical. |

**None of these clear a wireable bar**, and — more importantly — none of them
are remotely large enough to matter: the SRS model's CLV gap is multiple
*percentage points* (ATS −3.48%, ML −9.36%); every signal here moves well
under 1% of residual variance. Stacking all five together, even generously,
would not plausibly close that gap. This is consistent with why NFL sides/
totals are one of the hardest markets in all of sports betting to beat —
enormous public volume and sharp money keep it efficiently priced, which is
exactly the environment where free, game-level context (as opposed to
play-level tendency/EPA data, or non-public information like injury/practice
reports) is least likely to carry a real, wireable edge.

**Not attempted this round**: offensive run/pass tendency and defensive
scheme fit — the "stylistic matchup" half of the brainstorm. Confirmed
feasible in principle (nflverse publishes free per-season play-by-play files,
`github.com/nflverse/nflverse-data` tag `pbp`, ~20MB gzipped CSV/season back
to 1999) but a real, separate engineering lift: the columns needed
(`play_type`, `epa`, `posteam`/`defteam`) sit after a free-text `desc` column
with embedded commas, so `games.ts`'s "plain comma split is safe" trick
doesn't apply — this needs an actual CSV parser (no such dependency exists in
this repo yet) plus new team-level, lookahead-safe aggregation. Worth
attempting on its own merits (EPA-based tendency data is where public NFL
analytics has found real signal historically), but sized and paced
separately from this round's cheap-signal sweep, and with the same tempered
expectation the table above sets: NFL game lines are a hard market, and nothing
tried so far — two structurally different rating models plus five context
signals — has found a wireable edge.
