import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { loadGradedLeans } from "@/lib/queries/edgeReport";
import { NBA_PROP_STATS } from "@/lib/nba/propStats";
import { screenRates } from "@/lib/screener/types";
import { cautiousEdge } from "@/lib/propModel/canonical";
import type { GradedLean } from "@/lib/tracking/types";
import { bootstrapCoef, calibration, impliedOf, logisticWithOffset, logit, segmentPerf, type PerfRow, type SegmentPerf } from "@/lib/audit/performance";

/**
 * The historical performance audit: every settled lean pick tracking froze
 * BEFORE its game (lib/tracking) — ARCHR's chance, the price, the books'
 * no-vig chance, projected minutes, z — graded after it, with the closing
 * line. Read-only. Run from the Model lab (script: audit:performance).
 *
 * WHAT IS FROZEN vs REBUILT. Frozen before tip: side, line, ARCHR's shown chance
 * (and the pre-correction raw chance), the best price and its book, the
 * books' no-vig chance, projected minutes, z, the Confidence grade (since
 * Nov 12), screener records (since Nov 17). Rebuilt here, from box scores of
 * games BEFORE the pick's game only (no later information): L5/L10/L15/season
 * records for older picks, games of history, starter share, and the cautious
 * edge (which reads the L10 record). Each rebuilt cut says so.
 *
 * OUT OF SAMPLE. Every frozen chance was made before its game, so the record
 * is out of sample for the model that made it. But on 2026-11-12 an NBA side
 * correction (lib/propModel/sideCalibration) was FITTED on the earlier picks
 * and shipped, and the unders finding behind it (and the screener sweep) came
 * from those same picks. So the picks are split by the model that made them:
 * "pre-correction" (where the unders finding was discovered: in-sample for
 * it) and "post-correction" (the clean out-of-sample test of it). Each pick
 * records both chances (prob vs rawProb), so the split is exact.
 */

type Regime = "pre-correction" | "post-correction";

interface Row extends PerfRow {
  lean: GradedLean;
  regime: Regime;
  side: "over" | "under";
  stat: string;
  date: string;
  book: string;
  projMinutes: number | null;
  /** Rebuilt from prior box scores where not frozen. */
  rates: { l5: [number, number]; l10: [number, number]; l15: [number, number]; szn: [number, number] } | null;
  ratesFrozen: boolean;
  games: number | null;
  starterShare: number | null;
  cautious: number | null;
}

const f1 = (x: number | null, d = 1) => (x === null || !Number.isFinite(x) ? "—" : x.toFixed(d));
const pc = (x: number | null, d = 1) => (x === null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`);
const spc = (x: number | null, d = 1) => (x === null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
const spt = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`);
const am = (x: number | null) => (x === null ? "—" : x > 0 ? `+${x}` : `${x}`);

function header() {
  console.log(
    `    ${"segment".padEnd(34)} ${"n".padStart(5)} ${"games".padStart(5)} ${"win%".padStart(6)} [95%]          ${"ARCHR".padStart(6)} ${"gap".padStart(6)} ${"ROI".padStart(7)} [95%]           ${"avg odds".padStart(8)} ${"Brier".padStart(6)} ${"bk Brier".padStart(8)} ${"logloss".padStart(7)} ${"bk ll".padStart(6)} ${"skill‰".padStart(7)} [95%]        ${"vs no-vig".padStart(9)} [95%]          ${"CLV".padStart(6)} (n, beat)  flag`
  );
}
function line(label: string, s: SegmentPerf) {
  console.log(
    `    ${label.slice(0, 34).padEnd(34)} ${String(s.n).padStart(5)} ${String(s.games).padStart(5)} ${pc(s.winRate).padStart(6)} [${pc(s.winLo, 0)},${pc(s.winHi, 0)}]`.padEnd(70) +
      ` ${pc(s.avgP).padStart(6)} ${spt(s.gap).padStart(6)} ${spc(s.roi).padStart(7)} [${spc(s.roiLo, 0)},${spc(s.roiHi, 0)}]`.padEnd(38) +
      ` ${am(s.avgAmerican).padStart(8)} ${f1(s.brier, 4).padStart(6)} ${f1(s.mktBrier, 4).padStart(8)} ${f1(s.logLoss, 3).padStart(7)} ${f1(s.mktLogLoss, 3).padStart(6)} ${f1(s.skill).padStart(7)} [${f1(s.skillLo)},${f1(s.skillHi)}]`.padEnd(70) +
      ` ${spt(s.overMarket).padStart(9)} [${spt(s.overMarketLo)},${spt(s.overMarketHi)}]`.padEnd(30) +
      ` ${spt(s.clv).padStart(6)} (${s.clvN}, ${pc(s.beatClose, 0)})  ${s.flag ?? ""}`
  );
}

type Cut = { key: string; title: string; rebuilt?: boolean; seg: (r: Row) => string | null; order?: string[] };

const bucket = (x: number, defs: [string, (v: number) => boolean][]) => defs.find(([, t]) => t(x))?.[0] ?? null;
const rateBucket = (r: [number, number] | undefined | null, w: string, minGames = 5) => {
  if (!r || r[1] < minGames) return `${w}: under ${minGames} games`;
  const v = r[0] / r[1];
  return `${w} ${v < 0.4 ? "under 40%" : v < 0.6 ? "40–59%" : v < 0.8 ? "60–79%" : "80%+"}`;
};

const CUTS: Cut[] = [
  { key: "side", title: "1. Over vs under", seg: (r) => r.side },
  { key: "stat", title: "2. Prop market", seg: (r) => r.stat },
  {
    key: "prob",
    title: "3. ARCHR probability",
    order: ["under 40%", "40–49%", "50–54%", "55–59%", "60–64%", "65–69%", "70%+"],
    seg: (r) => bucket(r.p, [["under 40%", (v) => v < 0.4], ["40–49%", (v) => v < 0.5], ["50–54%", (v) => v < 0.55], ["55–59%", (v) => v < 0.6], ["60–64%", (v) => v < 0.65], ["65–69%", (v) => v < 0.7], ["70%+", () => true]]),
  },
  {
    key: "odds",
    title: "4. Odds",
    order: ["−200 or shorter", "−199 to −101", "+100 to +124", "+125 to +149", "+150 to +199", "+200+"],
    seg: (r) => (r.price === null ? null : bucket(r.price, [["−200 or shorter", (v) => v <= -200], ["−199 to −101", (v) => v < 100], ["+100 to +124", (v) => v < 125], ["+125 to +149", (v) => v < 150], ["+150 to +199", (v) => v < 200], ["+200+", () => true]])),
  },
  {
    key: "cautious",
    title: "5. Cautious edge (rebuilt: reads the L10 record)",
    rebuilt: true,
    order: ["negative", "0–5%", "5–10%", "10–20%", "20%+"],
    seg: (r) => (r.cautious === null ? null : bucket(r.cautious, [["negative", (v) => v < 0], ["0–5%", (v) => v < 0.05], ["5–10%", (v) => v < 0.1], ["10–20%", (v) => v < 0.2], ["20%+", () => true]])),
  },
  { key: "l5", title: "6a. L5 at the line (rebuilt for picks before Nov 17)", rebuilt: true, seg: (r) => rateBucket(r.rates?.l5, "L5") },
  { key: "l10", title: "6b. L10 at the line", rebuilt: true, seg: (r) => rateBucket(r.rates?.l10, "L10") },
  { key: "l15", title: "6c. L15 at the line", rebuilt: true, seg: (r) => rateBucket(r.rates?.l15, "L15") },
  { key: "szn", title: "6d. This season at the line", rebuilt: true, seg: (r) => rateBucket(r.rates?.szn, "season") },
  {
    key: "minutes",
    title: "7a. Projected minutes (frozen)",
    seg: (r) => (r.projMinutes === null ? "no projection" : bucket(r.projMinutes, [["under 20", (v) => v < 20], ["20–27", (v) => v < 28], ["28–33", (v) => v < 34], ["34+", () => true]])),
  },
  {
    key: "role",
    title: "7b. Role: starts in his last 10 (rebuilt)",
    rebuilt: true,
    seg: (r) => (r.starterShare === null ? null : r.starterShare >= 0.7 ? "starter (7+ of 10)" : r.starterShare <= 0.3 ? "bench (3 or fewer)" : "mixed"),
  },
  {
    key: "sample",
    title: "7c. Games of history (rebuilt)",
    rebuilt: true,
    seg: (r) => (r.games === null ? null : bucket(r.games, [["under 20 games", (v) => v < 20], ["20–49", (v) => v < 50], ["50–99", (v) => v < 100], ["100+", () => true]])),
  },
  { key: "book", title: "7d. Sportsbook (the book with the best price when frozen)", seg: (r) => r.book },
  { key: "grade", title: "Confidence grade when frozen (recorded since Nov 12)", seg: (r) => (r.lean.features.confidence ? `grade ${r.lean.features.confidence.grade}` : null) },
  {
    key: "z",
    title: "Projection distance |z| (frozen)",
    seg: (r) => (typeof r.lean.features.z !== "number" ? null : bucket(Math.abs(r.lean.features.z), [["under 0.35", (v) => v < 0.35], ["0.35–0.75", (v) => v < 0.75], ["0.75–6", (v) => v <= 6], ["degenerate (>6)", () => true]])),
  },
  { key: "regime", title: "Model regime", seg: (r) => r.regime },
];

function printCut(rows: Row[], cut: Cut, seed: number): { label: string; s: SegmentPerf }[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = cut.seg(r);
    if (k !== null) (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const keys = cut.order ? [...cut.order.filter((k) => groups.has(k)), ...[...groups.keys()].filter((k) => !cut.order!.includes(k))] : [...groups.keys()].sort((a, b) => groups.get(b)!.length - groups.get(a)!.length);
  console.log(`\n  ── ${cut.title}`);
  header();
  const out: { label: string; s: SegmentPerf }[] = [];
  for (const k of keys) {
    const s = segmentPerf(groups.get(k)!, seed);
    line(k, s);
    out.push({ label: `${cut.title.split(" (")[0]} · ${k}`, s });
  }
  return out;
}

/** Under's effect beyond the books' no-vig chance and ARCHR's own disagreement with it: won ~ offset(logit market) + b·under + c·(logit ARCHR − logit market). */
function underEffect(rows: Row[]) {
  const withMkt = rows.filter((r) => r.market !== null);
  const fit = (rs: Row[]) => logisticWithOffset(rs.map((r) => ({ y: r.won, offset: logit(r.market!), x: [r.side === "under" ? 1 : 0, logit(r.p) - logit(r.market!)] })))?.[0] ?? null;
  return { n: withMkt.length, ...bootstrapCoef(withMkt, fit) };
}

/** Under minus over within each odds bucket × ARCHR-chance bucket (both sides 20+), weighted by the smaller side: ROI and win − no-vig. */
function stratifiedUnderMinusOver(rows: Row[]) {
  const key = (r: Row) => `${r.price === null ? "np" : r.price <= -150 ? "a" : r.price < 100 ? "b" : r.price < 150 ? "c" : "d"}|${r.p < 0.5 ? 0 : r.p < 0.55 ? 1 : r.p < 0.6 ? 2 : 3}`;
  const cells = new Map<string, { over: Row[]; under: Row[] }>();
  for (const r of rows) {
    if (r.price === null || r.market === null) continue;
    const c = cells.get(key(r)) ?? cells.set(key(r), { over: [], under: [] }).get(key(r))!;
    c[r.side].push(r);
  }
  const roi = (rs: Row[]) => rs.reduce((a, r) => a + (r.won ? 1 / impliedOf(r.price!) - 1 : -1), 0) / rs.length;
  const over = (rs: Row[]) => rs.reduce((a, r) => a + r.won - r.market!, 0) / rs.length;
  let w = 0;
  let dRoi = 0;
  let dOver = 0;
  let used = 0;
  for (const c of cells.values()) {
    if (c.over.length < 20 || c.under.length < 20) continue;
    const wt = Math.min(c.over.length, c.under.length);
    w += wt;
    dRoi += wt * (roi(c.under) - roi(c.over));
    dOver += wt * (over(c.under) - over(c.over));
    used++;
  }
  return w ? { cells: used, roi: dRoi / w, overMarket: dOver / w } : null;
}

/** Does a record window add anything beyond ARCHR's chance (and beyond the books')? won ~ offset(logit chance) + b·(rate − 0.5), 5+ games. */
function windowAddsInfo(rows: Row[], w: "l5" | "l10" | "l15" | "szn") {
  const ok = rows.filter((r) => r.rates && r.rates[w][1] >= 5);
  const rate = (r: Row) => r.rates![w][0] / r.rates![w][1] - 0.5;
  const vsArchr = bootstrapCoef(ok, (rs) => logisticWithOffset(rs.map((r) => ({ y: r.won, offset: logit(r.p), x: [rate(r)] })))?.[0] ?? null);
  const mk = ok.filter((r) => r.market !== null);
  const vsBooks = bootstrapCoef(mk, (rs) => logisticWithOffset(rs.map((r) => ({ y: r.won, offset: logit(r.market!), x: [rate(r)] })))?.[0] ?? null);
  return { n: ok.length, vsArchr, vsBooks };
}

async function nbaRows(leans: GradedLean[]): Promise<Row[]> {
  const ids = [...new Set(leans.map((l) => l.features.playerId).filter((x): x is string => Boolean(x)))];
  const logs = ids.length ? await prisma.nbaPlayerGameLog.findMany({ where: { nbaPlayerId: { in: ids }, minutes: { gt: 0 } } }) : [];
  const byPlayer = new Map<string, typeof logs>();
  for (const l of logs) (byPlayer.get(l.nbaPlayerId) ?? byPlayer.set(l.nbaPlayerId, []).get(l.nbaPlayerId)!).push(l);
  for (const list of byPlayer.values()) list.sort((a, b) => b.gameDate.getTime() - a.gameDate.getTime());
  return leans.map((l) => {
    const f = l.features;
    const day = etDateOf(l.startsAt);
    // Games strictly before the pick's game date: nothing from that night or later.
    const prior = (byPlayer.get(f.playerId ?? "") ?? []).filter((g) => etDateOf(g.gameDate) < day);
    const stat = NBA_PROP_STATS.find((s) => s.key === f.stat);
    const season = (byPlayer.get(f.playerId ?? "") ?? []).find((g) => etDateOf(g.gameDate) === day)?.season ?? prior[0]?.season ?? 0;
    const side = f.side === "under" ? "under" : "over";
    const rebuilt = stat && f.point !== null && prior.length ? screenRates(prior.map((g) => ({ season: g.season, value: stat.value(g) })), side, f.point, season) : null;
    const rates = f.rates ?? (rebuilt ? { l5: rebuilt.l5, l10: rebuilt.l10, l15: rebuilt.l15, szn: rebuilt.szn } : null);
    const last10 = prior.slice(0, 10);
    const rate = rates ? (rates.l10[1] >= 5 ? rates.l10 : rates.szn) : null;
    return {
      lean: l,
      cluster: l.eventRef ?? day,
      won: l.result === "hit" ? 1 : 0,
      p: l.prob,
      market: f.marketProb,
      price: f.price,
      close: l.closingProb,
      regime: typeof f.rawProb === "number" && Math.abs(f.rawProb - l.prob) > 1e-9 ? "post-correction" : "pre-correction",
      side,
      stat: f.stat,
      date: day,
      book: f.book ?? "unknown",
      projMinutes: typeof f.minutes === "number" ? f.minutes : null,
      rates,
      ratesFrozen: Boolean(f.rates),
      games: stat ? prior.length : null,
      starterShare: last10.length >= 5 ? last10.filter((g) => g.starter).length / last10.length : null,
      cautious: rate ? cautiousEdge(l.prob, rate, f.price) : null,
    } satisfies Row;
  });
}

async function main() {
  const all = await loadGradedLeans(365);
  console.log("ARCHR EDGE — HISTORICAL PERFORMANCE AUDIT (settled picks frozen before each game)");
  console.log(`Settled tracked picks loaded: ${all.length}`);

  // ── Inventory: what's stored, by tracked model.
  console.log("\n═══ 0. What's stored ═══");
  const groups = new Map<string, GradedLean[]>();
  for (const l of all) {
    const k = `${l.features.sport.toUpperCase()} ${l.features.kind}${l.features.alt ? " (alt)" : ""}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(l);
  }
  for (const [k, ls] of [...groups].sort()) {
    const by = (res: string) => ls.filter((l) => l.result === res).length;
    const dates = ls.map((l) => etDateOf(l.startsAt)).sort();
    const settled = ls.filter((l) => l.result === "hit" || l.result === "miss");
    console.log(
      `  ${k.padEnd(18)} ${String(ls.length).padStart(5)} settled · hit ${by("hit")} miss ${by("miss")} push ${by("push")} void ${by("void")} · ${dates[0]} → ${dates[dates.length - 1]} (${new Set(dates).size} days)` +
        ` · priced ${pc(settled.filter((l) => l.features.price !== null).length / (settled.length || 1), 0)} · no-vig market ${pc(settled.filter((l) => l.features.marketProb !== null).length / (settled.length || 1), 0)} · closing ${pc(settled.filter((l) => l.closingProb !== null).length / (settled.length || 1), 0)} · grade ${pc(settled.filter((l) => l.features.confidence).length / (settled.length || 1), 0)}`
    );
  }

  // ── The primary universe: NBA main-line prop picks, hit or miss, priced, one per player × stat × game.
  const nbaMain = all.filter((l) => l.features.sport === "nba" && l.features.kind === "prop" && !l.features.alt);
  const settled = nbaMain.filter((l) => l.result === "hit" || l.result === "miss");
  const seen = new Set<string>();
  const deduped: GradedLean[] = [];
  let dups = 0;
  for (const l of [...settled].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const k = `${l.eventRef}|${l.features.playerId}|${l.features.stat}`;
    if (seen.has(k)) {
      dups++;
      continue;
    }
    seen.add(k);
    deduped.push(l);
  }
  const priced = deduped.filter((l) => l.features.price !== null);
  console.log(`\nNBA main-line prop picks: ${nbaMain.length} settled → ${settled.length} hit/miss (pushes ${nbaMain.filter((l) => l.result === "push").length}, voids ${nbaMain.filter((l) => l.result === "void").length} set aside) → ${dups} duplicate player×stat×game dropped → ${deduped.length} → ${priced.length} with a recorded price (the audit set)`);
  const rows = await nbaRows(priced);
  const pre = rows.filter((r) => r.regime === "pre-correction");
  const post = rows.filter((r) => r.regime === "post-correction");
  const span = (rs: Row[]) => {
    const d = rs.map((r) => r.date).sort();
    return d.length ? `${d[0]} → ${d[d.length - 1]}, ${new Set(d).size} slate days, ${new Set(rs.map((r) => r.cluster)).size} games` : "none";
  };
  console.log(`  pre-correction (the unders finding was discovered here: in-sample for it): ${pre.length} picks · ${span(pre)}`);
  console.log(`  post-correction (clean out-of-sample test): ${post.length} picks · ${span(post)}`);
  console.log(`  records frozen at capture: ${rows.filter((r) => r.ratesFrozen).length}; rebuilt from prior box scores: ${rows.filter((r) => !r.ratesFrozen && r.rates).length}; none: ${rows.filter((r) => !r.rates).length}`);
  console.log(`  players with the same stat family on one night are correlated: ${rows.length} picks over ${new Set(rows.map((r) => r.cluster)).size} games (${f1(rows.length / (new Set(rows.map((r) => r.cluster)).size || 1))} per game) — every interval resamples whole games`);
  console.log("\nColumns: win% [cluster-bootstrap 95%] · ARCHR = avg predicted · gap = actual − predicted (pts) · ROI flat at the recorded price [95%] · avg odds · Brier/log loss for ARCHR and the books' no-vig (bk) on the same picks · skill‰ = bk Brier − ARCHR Brier ×1000 [95%] (+: ARCHR closer) · vs no-vig = won − books' no-vig chance (pts) [95%] · CLV = no-vig move toward the pick, capture → close (pts)");
  console.log("Flags: 'too few' under 30 picks, 'small sample' under 200.");

  const ranked: { label: string; regime: string; s: SegmentPerf }[] = [];
  for (const [name, rs, seed] of [["ALL NBA MAIN-LINE PICKS", rows, 7], ["POST-CORRECTION ONLY (clean out-of-sample)", post, 9], ["PRE-CORRECTION ONLY (discovery period)", pre, 13]] as const) {
    console.log(`\n\n═══ ${name} — ${rs.length} picks ═══`);
    console.log("  ── Overall");
    header();
    line("every pick", segmentPerf(rs, seed));
    for (const cut of CUTS) {
      if (name !== "ALL NBA MAIN-LINE PICKS" && cut.key === "regime") continue;
      for (const x of printCut(rs, cut, seed)) ranked.push({ ...x, regime: name });
    }
  }

  // ── Unders vs overs, adjusted.
  console.log("\n\n═══ DO UNDERS GENUINELY OUTPERFORM OVERS? ═══");
  for (const [name, rs] of [["all", rows], ["post-correction (out of sample)", post], ["pre-correction (in sample for the finding)", pre]] as const) {
    const eff = underEffect(rs);
    const strat = stratifiedUnderMinusOver(rs);
    console.log(`  ${name}:`);
    console.log(`    logistic, won ~ offset(logit books' no-vig) + b·under + c·(logit ARCHR − logit books): b = ${f1(eff.est, 3)} [${f1(eff.lo, 3)}, ${f1(eff.hi, 3)}] on ${eff.n} picks (b > 0 with the interval above 0 = unders beat their own no-vig price beyond what ARCHR's disagreement explains)`);
    console.log(`    stratified by odds × ARCHR-chance cells (both sides 20+): ${strat ? `${strat.cells} cells · under − over ROI ${spc(strat.roi)} · under − over (won − no-vig) ${spt(strat.overMarket)} pts` : "no cell has 20+ of each side"}`);
  }

  // ── Do the hit-rate windows add information?
  console.log("\n\n═══ DO L5 / L10 / L15 / SEASON HIT RATES ADD PREDICTIVE INFORMATION? ═══");
  console.log("  won ~ offset(logit chance) + b·(hit rate − 50%), 5+ games in the window; b > 0 with its interval above 0 = the window knows something the chance doesn't. Records rebuilt from prior box scores where not frozen.");
  for (const [name, rs] of [["all", rows], ["post-correction", post]] as const)
    for (const w of ["l5", "l10", "l15", "szn"] as const) {
      const r = windowAddsInfo(rs, w);
      console.log(`    ${name.padEnd(16)} ${w.padEnd(4)} n=${String(r.n).padStart(5)} · beyond ARCHR: b = ${f1(r.vsArchr.est, 3)} [${f1(r.vsArchr.lo, 3)}, ${f1(r.vsArchr.hi, 3)}] · beyond the books: b = ${f1(r.vsBooks.est, 3)} [${f1(r.vsBooks.lo, 3)}, ${f1(r.vsBooks.hi, 3)}]`);
    }

  // ── Ranking.
  console.log("\n\n═══ RANKING (segments with 200+ picks; by the LOWER end of each 95% interval, never by raw win rate) ═══");
  const big = ranked.filter((x) => x.s.n >= 200);
  const show = (title: string, list: typeof big, v: (s: SegmentPerf) => number | null) => {
    console.log(`  ${title}`);
    for (const x of list) console.log(`    ${x.regime.split(" (")[0].padEnd(28)} ${x.label.slice(0, 60).padEnd(60)} n=${String(x.s.n).padStart(5)} ROI ${spc(x.s.roi)} [${spc(x.s.roiLo, 0)},${spc(x.s.roiHi, 0)}] · vs no-vig ${spt(x.s.overMarket)} [${spt(x.s.overMarketLo)},${spt(x.s.overMarketHi)}] · skill ${f1(x.s.skill)} [${f1(x.s.skillLo)},${f1(x.s.skillHi)}] · ${f1(v(x.s), 3)}`);
  };
  const by = (v: (s: SegmentPerf) => number | null) => [...big].filter((x) => v(x.s) !== null).sort((a, b) => v(b.s)! - v(a.s)!);
  show("STRONGEST by ROI lower bound", by((s) => s.roiLo).slice(0, 12), (s) => s.roiLo);
  show("WEAKEST by ROI upper bound", by((s) => s.roiHi).reverse().slice(0, 12), (s) => s.roiHi);
  show("STRONGEST by win − no-vig lower bound (predictive, odds-adjusted)", by((s) => s.overMarketLo).slice(0, 12), (s) => s.overMarketLo);
  show("STRONGEST by skill vs the books (Brier) lower bound", by((s) => s.skillLo).slice(0, 8), (s) => s.skillLo);

  // ── Calibration (chart data).
  const edges = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8];
  const calib = {
    archrAll: calibration(rows.map((r) => ({ p: r.p, won: r.won })), edges),
    booksAll: calibration(rows.filter((r) => r.market !== null).map((r) => ({ p: r.market!, won: r.won })), edges),
    archrPost: calibration(post.map((r) => ({ p: r.p, won: r.won })), edges),
    booksPost: calibration(post.filter((r) => r.market !== null).map((r) => ({ p: r.market!, won: r.won })), edges),
    archrOver: calibration(rows.filter((r) => r.side === "over").map((r) => ({ p: r.p, won: r.won })), edges),
    archrUnder: calibration(rows.filter((r) => r.side === "under").map((r) => ({ p: r.p, won: r.won })), edges),
  };
  console.log("\n\n═══ CALIBRATION (reliability by probability bucket) ═══");
  for (const [k, bins] of Object.entries(calib)) {
    console.log(`  ${k}`);
    for (const b of bins) console.log(`    ${pc(b.lo, 0)}–${pc(b.hi, 0)}  n=${String(b.n).padStart(5)}  said ${pc(b.meanP)}  won ${pc(b.actual)}  gap ${spt(b.actual - b.meanP)}`);
  }
  console.log(`@@CALIB_JSON@@${JSON.stringify(calib)}`);

  // ── The other tracked picks, briefly.
  console.log("\n\n═══ OTHER TRACKED PICKS ═══");
  const others: [string, GradedLean[]][] = [
    ["NBA alt-line props (one-sided: no no-vig market)", all.filter((l) => l.features.sport === "nba" && l.features.kind === "prop" && l.features.alt)],
    ["NFL props (no recorded price: ROI not computable)", all.filter((l) => l.features.sport === "nfl" && l.features.kind === "prop")],
    ["NBA game lines", all.filter((l) => l.features.sport === "nba" && l.features.kind !== "prop")],
    ["NFL game lines", all.filter((l) => l.features.sport === "nfl" && l.features.kind !== "prop")],
  ];
  header();
  for (const [name, ls] of others) {
    const s = ls.filter((l) => l.result === "hit" || l.result === "miss");
    line(name, segmentPerf(s.map((l) => ({ cluster: l.eventRef ?? etDateOf(l.startsAt), won: l.result === "hit" ? 1 : 0, p: l.prob, market: l.features.marketProb, price: l.features.price, close: l.closingProb })), 17));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
