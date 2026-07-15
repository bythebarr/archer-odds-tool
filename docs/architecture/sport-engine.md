# ARCHR Sport Engine — Design Doc

> **Status:** in progress (2026-07-15). The governing architecture for ARCHR's
> full, every-sport deployment. Phases 0–2 are **done** (contract + MLB/UFC
> proving adapters, parity-tested). **Phase 3 is done**: grading (3a), the
> `Sport`-enum retirement on the ledger (3b), the daily board (3c), and the
> nav/Slate collapse onto one registry (3d) all route through `SPORTS`, with a
> byte-for-byte parity test locking the poster's output. Tennis/soccer/F1 now
> register as thin adapters (Phase 4 pulled forward for the nav/Slate collapse —
> one pass, no backtracking), so **every** sport surface derives from the
> registry. The `todays-board` / `tracked-plays` channel split + `/track` are a
> deliberate follow-on (the board's output shape is preserved for now).

## Why this exists

ARCHR is meant to cover **every sport and every prop, with no ceiling** — the
everything-hub. Today it can't, and the audit shows why:

- **Four disagreeing "list of sports" registries.** The DB `Sport` enum, `nav.ts`,
  `sports.ts`, and `slate.ts` each carry their own sport list, none derived from a
  shared source, none in sync (the enum has `ufc` but not `f1`; nav lists `f1`; etc.).
- **Two bespoke pipelines duct-taped together.** MLB runs through a real model +
  the odds pool; UFC has an *entirely separate* parallel machine (`ufcBestPlays.ts`,
  its own tables, its own embed appended at a fixed seam).
- **The model is MLB-only.** `modelEv` is non-null only for MLB game lines
  (`oddsPool.ts`). Tennis/soccer/F1 posted plays are *voided out of the record*
  by the grader (`postResults.ts:gradePending`).
- **Adding a sport = editing 12+ files by hand**, with no compiler guarantee they
  stay in sync. This is the source of the constant "fixing."

The fix is not more special-casing. It's a **sport-agnostic core** where each sport
is a self-contained plug-in.

## Principles

1. **The engine speaks only `Play`.** After the adapter boundary, no code ever asks
   "is this MLB?" again. The board, `/track`, the ledger, the results recap, and the
   nav all operate on normalized objects.
2. **The adapter owns its own weirdness.** A sport's data model, pricing model, and
   grading rules are sealed *inside* its adapter. UFC's separate tables and
   fighter-math, F1's odd schedule — all hidden behind the same contract. The mess is
   boxed, and every box looks identical from the outside.
3. **One registry, single source of truth.** Nav, slate, board, and the enum-equivalent
   all derive from one `SPORTS` registry. Adding a sport touches the registry, not a
   dozen scattered literal lists.
4. **Limitless engine, budget-paced rollout.** The code has no sport/prop ceiling;
   sports light up one adapter at a time as their data feeds get funded.
5. **Prove before expand.** Migrate the two *most different* sports we already have
   (MLB model + UFC fighter-math) onto the contract first. If one contract fits both,
   it fits anything.

## Core abstractions

### The normalized `Play`

The single object the engine speaks. Every adapter produces these; every downstream
system consumes them.

```ts
interface Play {
  sportKey: string;          // registry key: "mlb", "ufc", ...
  playKey: string;           // stable dedupe key within (date, sport)
  eventRef: string;          // adapter-owned id (Game.id, UfcBout.id, ...)
  postedForDate: string;     // ET YYYY-MM-DD the play settles under
  selection: SelectionSpec;  // market + side + point + human label
  bestPrice: number;         // American odds, line-shopped
  bestBookName: string;
  marketEv: number | null;   // devig-consensus lens (2-way markets)
  modelEv: number | null;    // adapter-model lens (null if no model)
  suggestedUnits: number;    // quarter-Kelly hint, capped by price
  // tracking (set by the /track flow, not the adapter):
  tracked?: boolean;
  units?: number;
  result?: "hit" | "miss" | "push" | null;
}
```

### The `SportAdapter` contract

```ts
interface SportAdapter {
  key: string;                       // "mlb"
  meta: SportMeta;                   // display name, icon, color, nav href, order

  /** Pull this sport's data into its own (adapter-owned) storage. */
  ingest(dateEt: string): Promise<IngestSummary>;

  /** Priced +EV candidates for the board on a given date. */
  listPlays(dateEt: string): Promise<Play[]>;

  /** Optional pricing model. Omit → the play carries market-only EV. */
  model?: SportModel;

  /** Grade one tracked play against its settled event. */
  grade(play: Play): Promise<PlayGrade>;   // hit | miss | push | void | pending

  markets: MarketSpec[];             // which markets it offers
  props?: PropSpec[];                // open, adapter-declared prop set
}
```

- **`ingest`** replaces the per-sport cron bodies. Each cron route becomes a thin
  wrapper: `adapter.ingest(today)`.
- **`listPlays`** is where pricing happens — the adapter applies its model (or falls
  back to market-only devig) and returns uniform `Play`s. This dissolves the
  MLB-pool-vs-UFC-separate-path split: the board just concatenates every adapter's
  `listPlays`.
- **`model`** is optional. No model → market-only EV. This is how a brand-new sport
  gets onto the board *immediately* (market EV) and gets a model *later* when we build
  one, with zero structural change.
- **`grade`** replaces the `if (sport === ...)` chain in `gradePending`. Dispatch
  becomes `registry.get(play.sportKey).grade(play)`.

### The registry

```ts
export const SPORTS: SportAdapter[] = [mlbAdapter, ufcAdapter, /* ... */];
export const sportByKey = new Map(SPORTS.map(a => [a.key, a]));
```

Nav, slate, the board, and the (future) sport-key column all derive from this. The
four hand-maintained lists collapse into one, and adding a sport becomes: implement an
adapter, push it into `SPORTS`.

## How the pipeline uses it

| System | Today | After |
|---|---|---|
| Board / card | MLB pool filter + UFC embed appended at a fixed seam | `SPORTS.flatMap(a => a.listPlays(date))`, sort, render — no sport branches |
| `/track` (everyday move) | n/a (built new) | operates on `Play` by `playKey`; adapter-agnostic |
| Grading / results | `if (sport==="ufc")… else if (!=="mlb") void…` | `sportByKey.get(play.sportKey).grade(play)` |
| Ledger / P&L | already generic (`tallyLedger`) | unchanged; only the `tracked` filter added |
| Nav / slate | 3 parallel literal lists | derived from `SPORTS` |

## Data-model strategy

- **Adapters own their storage.** We do *not* force every sport into the shared `Game`
  table. UFC/F1 already have their own table families — that stays. Normalization
  happens at the `Play`/`PlayGrade` boundary, not the storage layer.
- **`PostedPlay.sport` moves from the closed `Sport` enum toward a registry string key**
  so a new sport flows through the ledger without a DB enum migration. (The enum can
  stay for existing typed relations; the engine keys off the registry.)
- **Props: replace the closed 11-value MLB `StatCategory` enum with adapter-declared
  `PropSpec`s.** Each sport declares its own prop types (and how to read the settled
  value). This is what opens "every prop in every sport."

## Known work the contract surfaces

- **3-way markets.** `devig`/`calculateEv` are 2-way only, so soccer's draw (and any
  3-way market) currently gets `null` EV. Generalizing devig to n-way is a required
  work item for market-only coverage of 3-outcome sports.
- **Late-settling events.** UFC settles after the morning recap via an out-of-band
  path. The contract keeps this: `grade` may return `pending`, and a settle cron
  re-runs `grade` for any sport whose events finish late.

## Migration plan (prove-then-expand, no big bang)

- **Phase 0 — Interfaces + registry, zero behavior change. ✅ done.** `Play`,
  `SportAdapter`, `SPORTS` defined. Nothing wired; no runtime effect.
- **Phase 1 — MLB adapter. ✅ done.** Wraps the model + odds pool + Kelly sizing +
  grading behind the contract (`src/lib/engine/adapters/mlb.ts`). `unitsFor`
  extracted to a pure `src/lib/betting/kelly` so the engine doesn't import the
  Discord card. Parity test: `selectBoardPlays`+`toPlay` reproduce postCard's
  selection verbatim. Registered; not yet wired to any live path.
- **Phase 2 — UFC adapter. ✅ done.** Wraps fighter-math + moneyline pricing + Cito
  ingest + UFC grading (`src/lib/engine/adapters/ufc.ts`). Parity test locks the
  field mapping incl. the fight-date `postedForDate`. Registered; the separate
  embed-append is NOT retired yet — that happens in Phase 3 when the board is
  rewired to `SPORTS.flatMap(listPlays)`.
- **Phase 3 — Collapse the registries + wire the board. ⏳ in progress.**
  - **3a — grading through the registry. ✅ done.** `postResults.gradePending`
    dispatches via `getAdapter(play.sportKey).grade`; the per-sport `if/else` chain
    and `gradeGameLine/gradeProp/gradeUfcMoneyline` orchestration drop out. No
    output change (an unregistered sport still voids exactly as before).
  - **3b — retire the `Sport` enum on the ledger. ✅ done.** `PostedPlay.sport`
    is now a plain registry string key (in-place `enum→text` cast migration — live
    graded rows keep their sport, no data loss), so a new sport flows through the
    ledger/grader with **no DB enum migration**. The `Sport` enum survives only on
    `Game.sport` (a typed relation with a CHECK constraint — MLB/tennis/soccer
    share that table). Resolves open decision #3.
  - **3c — board wired to the registry. ✅ done.** The daily poster assembles from
    `SPORTS.flatMap(listPlays)`, groups by sport, and records generically
    (`sport: play.sportKey`) — the hardcoded `getUfcBestPlays`/`buildUfcEmbed` seam
    is gone. Each adapter pre-renders its play's card line into `Play.display.line`
    (MLB's edge/units voice, UFC's finish-lean voice) so the board concatenates
    lines with no "is this MLB?" branch; the shared formatters live in the neutral
    `@/lib/card/line` (keeps the engine's zero-`@/lib/discord`-imports posture). A
    UFC odds-freshness `refresh()` hook on the adapter replaces the poster's direct
    `ensureUfcOddsFresh` call. **Byte-for-byte output is locked by
    `postCard.parity.test.ts`** (MLB-green card + UFC-red Fight-Night embed +
    free-lean tease, all scenarios). The `SECTION_CHROME` map (per-sport embed
    color/title) is the last sport-keyed literal in the poster; it dissolves with
    the channel redesign.
  - **3d — collapse nav/Slate onto one registry. ✅ done.** Every parallel sport
    list is gone: `nav.ts` sport tabs, `sports.ts` (`NAV_SPORT_META`/`SPORT_ORDER`/
    `SPORT_META`/`F1_META`), the dashboard's duplicate `SPORT_ORDER`, and the dead
    `SLATE_SPORTS` all derive from the registry now. `SlateSport`/`NavSport` are
    derived types (`Exclude`/`keyof` over the meta list), not hand-kept unions.
    **Client-safety seam:** sport identity+display lives in a pure leaf,
    `engine/sportsMeta.ts` (`SPORT_METAS`), which the heavy `SportAdapter`s
    reference via `meta` — so the client nav bars / odds board import ONE meta
    source without dragging prisma/ingest into the browser bundle (proven by
    `next build`). `resultsOnly` on the meta is what splits nav (all sports) from
    the Slate (odds sports); F1 sets it.
  - **Phase 4 pulled forward (partial).** Tennis/soccer/F1 register as thin
    adapters NOW — real `meta` + `ingest`, an empty board (`listPlays: []`) until
    their paid-EV lens lands, a conservative `grade`. Doing this to enable 3d (vs.
    deriving nav from a 2-sport registry and re-adding them later) was the
    no-backtracking call. What's LEFT for full Phase 4: the +EV models
    (tennis/soccer) and n-way devig for soccer's 1X2 — then `listPlays` fills in
    and the board lights those sections up with no other change.
- **Phase 5 — New sports are pure adds.** Ship the "How to add a sport" checklist.

## Definition of done

> **Adding a sport = writing one adapter file and adding one line to the registry.**
> Nothing in the board, ledger, grader, or nav is touched. Ever.

## Open decisions (product-level, for Free)

1. **Rollout order** after MLB/UFC — which sport's data feed gets funded first?
   (NFL for fall, or light up the market-only sports we already ingest — tennis/soccer/F1 —
   for breadth?)
2. **Prop breadth per sport** at launch — full prop menu, or game lines first then
   props as a fast-follow per sport?
3. **DB `Sport` enum** — ✅ **resolved (Phase 3b): retired on the ledger path now.**
   `PostedPlay.sport` is a registry string; the enum stays only on `Game.sport`.
   Deferring was rejected as exactly the backtracking the every-sport mandate
   forbids — a market-only sport (F1/NFL) would otherwise need an enum migration
   plus a re-touch of the write path. The cast was in-place, so no graded rows
   were lost.
