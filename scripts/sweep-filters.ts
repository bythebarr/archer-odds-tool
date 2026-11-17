import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { closingGameLines, teamBaselinesByGame } from "./props/history";
import { gradedNbaSides } from "./props/nbaGradedSides";
import { gradedNflSides } from "./props/nflGradedSides";
import { leanScreenRows, type LeanScreenRow } from "./props/leanScreenRows";
import { loadGradedLeans } from "@/lib/queries/edgeReport";
import { edgeOf, type Rate } from "@/lib/builder/types";
import { passes, type ScreenWindow, type ScreenerProp } from "@/lib/screener/types";
import { confidenceOf } from "@/lib/propModel/confidence";
import { MIN_HALF_PICKS, PRICE_FLOOR, comboGrid, evaluate, pickStats, splitDate, stable, walkForward, type ComboResult, type PickStats, type SweepRow } from "@/lib/audit/filterSweep";

/**
 * The filter sweep (lib/audit/filterSweep): every combination of the props
 * screener's filters — a record bar on the L3…last-season windows, ARCHR's
 * chance, the edge, side, the long end of the price range and (NBA) projected
 * minutes — with the −200 price floor always on, run through the screener's own
 * `passes` over every settled NBA and NFL prop lean (pick tracking: ARCHR's side
 * at each main line, priced at capture), with the screener's records rebuilt
 * from the player's prior games (scripts/props/leanScreenRows). The
 * closing-price backtests (both sides of every line, prior games only) are a
 * cross-check; they cover only the slates whose prop quotes are still stored.
 * For each: hit rate,
 * flat-stake ROI at the closing price, picks left per slate day, both date
 * halves. Then the filters the screener can't set yet, tried on top of the
 * chosen set. Read-only. Run from the Model lab (script: sweep:filters).
 */
interface Row extends SweepRow {
  /** Not screener filters (yet): for the add-on section. */
  z: number | null;
  market: number | null;
  games: number;
  roleL10: Rate | null;
  confidence: number | null;
}

const pct = (x: number | null, d = 1) => (x === null || Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
const hit = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
const cell = (s: PickStats) => `${String(s.n).padStart(5)} picks · hit ${hit(s.hitRate).padStart(6)} · ROI ${pct(s.roi).padStart(7)}`;
const line = (r: ComboResult) =>
  `${cell(r.all)} [${pct(r.all.lo, 0)}, ${pct(r.all.hi, 0)}] · ${r.perDay.toFixed(1).padStart(5)}/day · early ${pct(r.early.roi).padStart(7)} (${r.early.n}) · late ${pct(r.late.roi).padStart(7)} (${r.late.n})\n      ${r.combo.label}`;

function toRow(sport: "nba" | "nfl", i: number, s: { stat: string; side: "over" | "under"; point: number; pBlend: number; marketChance: number; priceAmerican: number | null; rates: Record<ScreenWindow, Rate>; rate: Rate; sampleGames: number; won: 0 | 1; date: string; z: number; minutes?: { projected: number; recent: number | null } | null; roleRate?: Rate | null }): Row {
  const prop: ScreenerProp = {
    id: `${sport}:${i}`,
    sport,
    league: sport.toUpperCase(),
    gameId: `${sport}:bt`,
    game: "",
    startsAt: s.date,
    team: "",
    opponent: "",
    player: "",
    stat: s.stat,
    statLabel: s.stat,
    side: s.side,
    point: s.point,
    main: true,
    priceAmerican: s.priceAmerican,
    bookName: null,
    archr: s.pBlend,
    edge: edgeOf(s.pBlend, s.priceAmerican),
    rates: s.rates,
    ...(s.minutes ? { minutes: Math.round(s.minutes.projected * 10) / 10 } : {}),
  };
  // The live grade's inputs as the backtest knows them; no report card (the track factor reads 0).
  const conf = confidenceOf({ archr: s.pBlend, marketChance: s.marketChance, priceAmerican: s.priceAmerican, rate: s.rate, sampleGames: s.sampleGames, minutes: s.minutes ?? null, z: s.z, side: s.side, sport });
  return { prop, won: s.won, date: s.date, z: s.z, market: s.marketChance, games: s.sampleGames, roleL10: s.roleRate ?? null, confidence: conf?.score ?? null };
}

/** A settled lean as the screener would have shown it: its side at the main line, the price at capture. */
function leanRow(i: number, l: LeanScreenRow): Row {
  const prop: ScreenerProp = {
    id: `${l.sport}:lean:${i}`,
    sport: l.sport,
    league: l.sport.toUpperCase(),
    gameId: `${l.sport}:lean`,
    game: "",
    startsAt: l.date,
    team: "",
    opponent: "",
    player: "",
    stat: l.stat,
    statLabel: l.stat,
    side: l.side,
    point: l.point,
    main: true,
    priceAmerican: l.price,
    bookName: null,
    archr: l.prob,
    edge: edgeOf(l.prob, l.price),
    rates: l.rates,
    ...(l.minutes !== null ? { minutes: Math.round(l.minutes * 10) / 10 } : {}),
  };
  return { prop, won: l.won, date: l.date, z: l.z, market: l.market, games: l.games, roleL10: null, confidence: l.confidence };
}

/** Filters the screener can't set today, each tried on top of a chosen set. */
const ADD_ONS: { label: string; keep: (r: Row) => boolean }[] = [
  { label: "|z| ≥ 0.75 (projection well off the line)", keep: (r) => r.z !== null && Math.abs(r.z) >= 0.75 && Math.abs(r.z) <= 6 },
  { label: "ARCHR within 8 pts of the books", keep: (r) => r.market !== null && Math.abs((r.prop.archr ?? 0) - r.market) <= 0.08 },
  { label: "ARCHR 3–15 pts above the books", keep: (r) => r.market !== null && (r.prop.archr ?? 0) - r.market > 0.03 && (r.prop.archr ?? 0) - r.market <= 0.15 },
  { label: "20+ games of history", keep: (r) => r.games >= 20 },
  { label: "role-weighted L10 ≥ 60% (NBA)", keep: (r) => r.roleL10 !== null && r.roleL10[1] > 0 && r.roleL10[0] / r.roleL10[1] >= 0.6 },
  { label: "Confidence ≥ 60 (B or better)", keep: (r) => (r.confidence ?? 0) >= 60 },
];

/** The rows a combination keeps: the screener's own `passes`. */
const keptBy = (c: ComboResult, r: Row) => passes(r.prop, c.combo.filters);

function addOns(rows: Row[], chosen: ComboResult) {
  const cut = splitDate(rows);
  const base = rows.filter((r) => keptBy(chosen, r));
  console.log(`\n  ── Filters the screener can't set yet, on top of: ${chosen.combo.label}`);
  console.log(`     ${"(the set alone)".padEnd(56)} ${cell(pickStats(base))} · early ${pct(pickStats(base.filter((r) => r.date <= cut)).roi)} · late ${pct(pickStats(base.filter((r) => r.date > cut)).roi)}`);
  for (const a of ADD_ONS) {
    const k = base.filter(a.keep);
    console.log(`     + ${a.label.padEnd(54)} ${cell(pickStats(k))} · early ${pct(pickStats(k.filter((r) => r.date <= cut)).roi)} (${k.filter((r) => r.date <= cut).length}) · late ${pct(pickStats(k.filter((r) => r.date > cut)).roi)} (${k.filter((r) => r.date > cut).length})`);
  }
}

function byStat(rows: Row[], chosen: ComboResult) {
  const kept = rows.filter((r) => keptBy(chosen, r));
  const stats = [...new Set(kept.map((r) => r.prop.stat))].sort();
  console.log(`\n  ── By stat (the screener's stat tiles can switch any of these off), within: ${chosen.combo.label}`);
  for (const s of stats.map((st) => ({ st, p: pickStats(kept.filter((r) => r.prop.stat === st)) })).sort((a, b) => b.p.n - a.p.n))
    console.log(`     ${s.st.padEnd(28)} ${cell(s.p)}`);
}

function sweep(label: string, rows: Row[], minutes: boolean) {
  console.log(`\n\n═══ ${label} ═══`);
  const days = new Set(rows.map((r) => r.date));
  const cut = splitDate(rows);
  console.log(`  ${rows.length} graded sides over ${days.size} slate days · earlier half through ${cut}`);
  const floorOnly = rows.filter((r) => r.prop.priceAmerican !== null && r.prop.priceAmerican >= PRICE_FLOOR);
  console.log(`  every side priced −200 or longer (no other filter): ${cell(pickStats(floorOnly))}`);
  const combos = comboGrid({ minutes });
  const results = evaluate(rows, combos);
  console.log(`  ${combos.length} combinations swept`);

  const held = stable(results);
  console.log(`\n  ── Held up: positive ROI in BOTH halves, ${MIN_HALF_PICKS}+ picks each — ${held.length} of ${combos.length}; top 12 by ROI`);
  for (const r of held.slice(0, 12)) console.log(`    ${line(r)}`);

  const enough = results.filter((r) => r.all.n >= 2 * MIN_HALF_PICKS);
  console.log(`\n  ── Highest hit rate (${2 * MIN_HALF_PICKS}+ picks), with what it pays — top 8`);
  for (const r of [...enough].sort((a, b) => (b.all.hitRate ?? 0) - (a.all.hitRate ?? 0)).slice(0, 8)) console.log(`    ${line(r)}`);

  const wf = walkForward(results);
  console.log(`\n  ── Walk-forward: the 10 best on the EARLIER half (${MIN_HALF_PICKS}+ picks), judged on the LATER half — ${wf.heldUp} of ${wf.picked.length} stayed positive`);
  for (const r of wf.picked) console.log(`    ${line(r)}`);

  // "Most accurate": the highest hit rate among the sets that held up in both halves.
  const chosen = [...held].sort((a, b) => (b.all.hitRate ?? 0) - (a.all.hitRate ?? 0))[0] ?? wf.picked[0];
  if (chosen) console.log(`\n  ── MOST ACCURATE (highest hit rate that held up in both halves): ${chosen.combo.label}\n    ${line(chosen)}`);
  if (chosen) {
    addOns(rows, chosen);
    byStat(rows, chosen);
  }
  return { results, held, wf };
}

async function main() {
  const rows: { nba: Row[]; nfl: Row[] } = { nba: [], nfl: [] };
  const failures: string[] = [];
  try {
    const [closing, baselines] = await Promise.all([closingGameLines("nba"), teamBaselinesByGame("nba", 30)]);
    rows.nba = (await gradedNbaSides(closing, baselines)).map((s, i) => toRow("nba", i, s));
  } catch (e) {
    failures.push(`NBA backtest: ${e instanceof Error ? e.message : e}`);
  }
  try {
    const [closing, baselines] = await Promise.all([closingGameLines("nfl"), teamBaselinesByGame("nfl", 17)]);
    rows.nfl = (await gradedNflSides(closing, baselines)).map((s, i) => toRow("nfl", i, s));
  } catch (e) {
    failures.push(`NFL backtest: ${e instanceof Error ? e.message : e}`);
  }

  // The main source: every settled prop lean, its screener records rebuilt from prior games.
  const leans: { nba: Row[]; nfl: Row[] } = { nba: [], nfl: [] };
  try {
    const built = await leanScreenRows(await loadGradedLeans(240));
    leans.nba = built.nba.map((l, i) => leanRow(i, l));
    leans.nfl = built.nfl.map((l, i) => leanRow(i, l));
    for (const sport of ["nba", "nfl"] as const) {
      const a = built.account[sport];
      console.log(
        `${sport.toUpperCase()} leans: ${a.settled} settled main-line props · dropped ${a.noPrice} with no price, ${a.noPlayer} with no player, ${a.noHistory} with no prior games · kept ${a.kept} · lowest ARCHR chance kept ${a.minProb === null ? "—" : `${(a.minProb * 100).toFixed(1)}%`} · ${a.graded} carry their Confidence grade`
      );
    }
  } catch (e) {
    failures.push(`Tracked leans: ${e instanceof Error ? e.message : e}`);
  }

  console.log("FILTER SWEEP — the props screener's own filters, price floor −200 always on");
  console.log("hit = share of picks that cashed · ROI = flat stakes at the price [95%] · /day = picks left per slate day · early/late = the two date halves");
  console.log("Main source: tracked leans (ARCHR's side at each main line, priced at capture, settled), records rebuilt from prior games.");
  if (leans.nba.length) sweep("NBA props · tracked leans (live, price at capture)", leans.nba, true);
  if (leans.nfl.length) sweep("NFL props · tracked leans (live, price at capture)", leans.nfl, false);
  if (leans.nba.length && leans.nfl.length) sweep("NBA + NFL props · tracked leans pooled", [...leans.nba, ...leans.nfl], false);
  console.log("\n\nCross-check: the closing-price backtests (both sides of every line, but only the slates whose prop quotes are still stored)");
  if (rows.nba.length) sweep("NBA props · backtest (closing prices)", rows.nba, true);
  if (rows.nfl.length) sweep("NFL props · backtest (closing prices)", rows.nfl, false);
  for (const f of failures) console.log(`  (skipped) ${f}`);
  if (!rows.nba.length && !rows.nfl.length && !leans.nba.length && !leans.nfl.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
