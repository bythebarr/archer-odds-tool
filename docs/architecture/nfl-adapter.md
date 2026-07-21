# NFL adapter — what it needs

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
