# ParlayAPI coverage, by sport

Measured live 2026-07-21, ~04:00 ET, in July. Re-run
`npx tsx scripts/odds/audit-coverage.ts` to refresh.

This exists because the provider switch was verified on MLB and then assumed to
generalise. It doesn't. The table is the correction, and the point of keeping it
is that "which sports can this provider actually carry" should be a number you
can look up, not a memory of a conversation.

**Read the volatile columns with suspicion.** Two runs ~10 minutes apart
disagreed sharply: NFL bettable books went 11 → 3, tennis ATP 4 → 0, NFL prop
rows 943 → 1,966. Books open and pull markets continuously, and an overnight
July snapshot catches the majors at their thinnest. Book counts and event counts
are a *floor*, not a measurement. Re-run near game time before trusting them.

| Sport | odds events | bettable books | Pinnacle | scores | prop rows | prop books | prop markets | odds↔scores ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **MLB** | 15–21 | **11** | yes | 15 | ~6,000 | 11 | **58–75** | 6–8/14 |
| **NFL** | 35–36 | 3–**11** | yes | 16 | 943–1,966 | 5 | **67–82** | 12/16 |
| **NBA** | 9–13 | 1–6 | no | 1 | 220–284 | 2 | 19 | n/a |
| UFC / MMA | 14 | 1–3 | yes | **0** | ~75 | 2 | 6 | n/a |
| Tennis ATP | 52–63 | 0–4 | yes | **0** | **0** | 0 | 0 | n/a |
| Tennis WTA | 34 | 2 | yes | **0** | **0** | 0 | 0 | n/a |
| Soccer (World Cup) | 0 | 0 | — | 0 | 0 | 0 | 0 | n/a |

"bettable books" counts only `BETTABLE_BOOK_KEYS` (see `src/lib/odds/bookAllowlist.ts`);
Pinnacle is tracked separately because it prices, it is never offered as a
best-line. Soccer's zeros are the World Cup being out of season, not a gap.

The columns that held steady across both runs are the ones worth deciding on:
**props exist or they don't** (tennis: zero, twice), **scores exist or they
don't** (tennis and UFC: zero, twice), Pinnacle presence, prop-market breadth,
and the id instability.

## What it means

**The US majors are the product.** MLB and NFL both reach 11 bettable books with
Pinnacle behind them, and carry 58–82 prop markets. That is a genuine
line-shopping surface with a sharp baseline — the thing the switch was made for.
NFL's 82 prop markets in the *off-season* is the strongest single number here.

**Tennis cannot carry a paid surface on this provider.** 52–63 ATP events sounds
healthy until you see the rest of the row: 0–4 books, and **zero props in both
runs**. Line-shopping across a handful of books is thin, and props — the edge
that survived backtesting (see `docs/architecture/calibration.md`) — do not
exist here at all. Tennis also gets no scores, so grading has no source either.
This is the one row that should change a roadmap.

**UFC is odds-only and shallow** at 3 bettable books, but note it *does* carry
some MMA props (77 rows / 6 markets) where The Odds API carried none. Small, but
it's new ground rather than a regression.

**Event ids are unstable across endpoints, in every sport.** The `odds↔scores
ids` column compares ids for games BOTH endpoints list: MLB agrees on 8 of 14,
NFL on 12 of 16. Partial agreement is the dangerous kind — an id join *works
sometimes*, so it degrades into silent partial data loss rather than an obvious
outage. **Never join ParlayAPI data across endpoints on an id.** Match on
normalized team/player names plus date, as `src/lib/props/eventMatch.ts` does.

## The rule this establishes

One provider does not cover every sport, and the codebase already knew that
before this doc did: MLB results come from the free MLB Stats API, UFC from
Cito, F1 from Jolpica. ParlayAPI is the **odds and props layer**, not the
everything layer.

So, per sport:

- **Deep coverage (MLB, NFL, NBA)** → full paid surface: line shopping, props,
  model EV.
- **Odds-only (UFC, tennis)** → signal-only feeder, or pair Parlay's prices with
  a sport-specific results source. Do not promise props there.
- **No coverage** → not a surface yet, whatever the roadmap says.

## Correction: the NFL sport key also serves CFL (2026-07-21)

The audit counted `americanfootball_nfl` events without checking what they were.
Building the NFL feed found the answer: **8 of them were CFL clubs** (Elks,
Roughriders, Stampeders, Blue Bombers, Argonauts, BC Lions, Tiger-Cats,
Alouettes). Nothing in the response marks them as a different league.

So the "odds events" column is a count of *events under a key*, not a count of
that sport's games — and any new sport must verify what the key actually contains
before trusting the number. NFL filters through a 32-team allowlist
(`src/lib/nfl/teams.ts`); see docs/architecture/nfl-adapter.md.

## Acted on: tennis is signal-only (2026-07-21)

The table said tennis has no scores; the code hadn't caught up. A
`grade-outcomes-tennis` cron ran every 2 days, spent 2 credits on `/scores`, got
nothing back, and graded nothing — and tennis plays were still posted to the card
and written to `PostedPlay`, where they could only ever read "pending".

So tennis now carries `signalOnly: true` in `SportMeta` (see
`src/lib/engine/sportsMeta.ts`). That flag means **priceable but not settleable**,
and it does three things: keeps the sport's page and Elo model running, keeps its
plays off the tracked card via `excludeSignalOnly`, and says so on the page rather
than leaving an empty record to be misread. The grading cron, its GitHub Actions
step, and `src/lib/tennis/grading.ts` are deleted — not disabled, since they could
not work against this provider at all.

The tennis adapter's `grade` is deliberately kept: pre-existing PostedPlay rows
still dispatch to it, and it's the grader the sport needs the day a results source
lands. **Wiring one is a one-line reversal** — clear `signalOnly` and tennis is
back on the card with no other change. That is the shape any future no-results
sport should take.

Adding a sport means checking this table first, not discovering the gap after
building the adapter.
