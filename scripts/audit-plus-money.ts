import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { attachNbaPostGame, loadGradedLeans } from "@/lib/queries/edgeReport";
import { lossBreakdown } from "@/lib/tracking/evaluate";
import type { GradedLean } from "@/lib/tracking/types";
import type { NbaPropStat } from "@/generated/prisma/client";
import { benjaminiHochberg, bootstrapCoef, calibration, decimalOf, impliedOf, logisticWithOffset, logit, segmentPerf, type PerfRow } from "@/lib/audit/performance";
import {
  PLUS_100_175,
  PRICE_BUCKETS,
  Z_035_075,
  Z_BUCKETS,
  Z_DEGENERATE,
  chronoFactorTest,
  fadeRow,
  leaveOneOut,
  lookupOpposite,
  profitConcentration,
  residualCorrelation,
  slateFeasibility,
  type FactorRow,
  type Quote,
} from "@/lib/audit/plusMoney";
import { nbaAuditRows, oppositePrice, type AuditRow } from "./props/nbaAuditRows";

/**
 * PLUS-MONEY ALPHA & CONTRARIAN FADE AUDIT (docs/plus-money-alpha-audit.md,
 * docs/contrarian-fade-audit.md). Read-only. Run from the Model lab (script:
 * audit:plus-money). Every result is printed as one JSON line (@@TAG@@{...})
 * so the reports are built from the run, not retyped.
 *
 * DATA. Settled NBA prop picks frozen before tip (lib/tracking), split by the
 * model that made them: "discovery" (frozen before the Nov 12 side correction:
 * the unders finding, the correction and the screener sweep were all fitted
 * here), "post" (frozen after it, through the last settled slate) and
 * "forward" (frozen after forward tracking began on Nov 17). Every hypothesis
 * tested here was shaped by an audit that had already looked at discovery AND
 * post, so both are EXPLORATORY for these questions; only forward data is
 * untouched, and it has not settled yet.
 *
 * FADES use the opposite side's ACTUAL DraftKings quote from NbaPropSnapshot:
 * same game, player, stat, line and book, the latest poll at or before the
 * pick was frozen, with the pick's own side checked against the price recorded
 * with it. No opposite quote, no fade: untestable, never reconstructed.
 */

type Period = "all" | "discovery" | "post" | "forward";
const emit = (tag: string, o: unknown) => console.log(`@@${tag}@@${JSON.stringify(o)}`);
const seg = (section: string, period: string, label: string, rows: PerfRow[], seed = 7) => {
  const s = segmentPerf(rows, seed);
  emit("SEG", { section, period, label, ...s });
  return s;
};
const periodOf = (r: AuditRow): Exclude<Period, "all"> => (r.forward ? "forward" : r.regime === "pre-correction" ? "discovery" : "post");
const byPeriod = <R extends AuditRow>(rows: R[]) => ({ all: rows, discovery: rows.filter((r) => periodOf(r) === "discovery"), post: rows.filter((r) => periodOf(r) === "post"), forward: rows.filter((r) => periodOf(r) === "forward") });
const span = (rs: { cluster: string; day?: string }[]) => ({ picks: rs.length, games: new Set(rs.map((r) => r.cluster)).size, days: new Set(rs.map((r) => r.day)).size });
const absZ = (r: AuditRow) => (r.zSide === null ? null : Math.abs(r.zSide));

async function main() {
  const graded = await loadGradedLeans(365);
  const nba = graded.filter((l) => l.features.sport === "nba" && l.features.kind === "prop");

  // ── PHASE 1: what's eligible.
  const settled = nba.filter((l) => l.result === "hit" || l.result === "miss");
  const seen = new Set<string>();
  let dups = 0;
  const unique: GradedLean[] = [];
  for (const l of [...settled].sort((a, b) => (a.capturedAt ?? a.startsAt).getTime() - (b.capturedAt ?? b.startsAt).getTime())) {
    const k = `${l.eventRef}|${l.features.playerId}|${l.features.stat}|${l.features.alt ? "alt" : "main"}`;
    if (seen.has(k)) {
      dups++;
      continue;
    }
    seen.add(k);
    unique.push(l);
  }
  const all = await nbaAuditRows(unique.filter((l) => l.features.price !== null));
  const leaked = all.filter((r) => r.afterTip);
  const rows = all.filter((r) => !r.afterTip);
  const main_ = rows.filter((r) => !r.alt);
  const alt = rows.filter((r) => r.alt);

  // Actual opposite-side quotes: per game, only the picks' players, stats and lines.
  const quotes = new Map<string, Quote[]>();
  const gameIds = [...new Set(rows.map((r) => r.cluster))];
  for (const g of gameIds) {
    const picks = rows.filter((r) => r.cluster === g && r.lean.features.playerId && r.lean.features.point !== null);
    if (!picks.length) continue;
    const snaps = await prisma.nbaPropSnapshot.findMany({
      where: { gameId: g, OR: picks.map((r) => ({ nbaPlayerId: r.lean.features.playerId!, stat: r.stat as NbaPropStat, point: r.lean.features.point! })) },
      select: { nbaPlayerId: true, stat: true, side: true, point: true, bookKey: true, priceAmerican: true, polledAt: true },
    });
    for (const s of snaps) {
      const k = `${g}|${s.nbaPlayerId}|${s.stat}`;
      (quotes.get(k) ?? quotes.set(k, []).get(k)!).push({ side: s.side, point: s.point, bookKey: s.bookKey, priceAmerican: s.priceAmerican, polledAt: s.polledAt });
    }
  }
  const opp = new Map<AuditRow, ReturnType<typeof lookupOpposite>>();
  for (const r of rows) {
    const f = r.lean.features;
    if (f.point === null || !f.playerId) continue;
    opp.set(r, lookupOpposite(quotes.get(`${r.cluster}|${f.playerId}|${r.stat}`) ?? [], { side: r.side, point: f.point, bookKey: "draftkings", price: r.price, decidedAt: (r.capturedAt ?? r.lean.startsAt).getTime(), startsAt: r.lean.startsAt.getTime() }));
  }
  const coverage = (rs: AuditRow[]) => {
    const look = rs.map((r) => opp.get(r)).filter(Boolean) as ReturnType<typeof lookupOpposite>[];
    const withOpp = look.filter((o) => o.opposite);
    const ids = look.filter((o) => o.identityOk !== null);
    return {
      n: rs.length,
      oppAtDecision: withOpp.length,
      oppShare: rs.length ? withOpp.length / rs.length : 0,
      sameSideFound: ids.length,
      identityMatch: ids.length ? ids.filter((o) => o.identityOk).length / ids.length : null,
      oppAtClose: look.filter((o) => o.closingOpposite).length,
      quoteAgeHoursMedian: (() => {
        const ages = rs.flatMap((r) => {
          const o = opp.get(r);
          return o?.opposite ? [((r.capturedAt ?? r.lean.startsAt).getTime() - o.opposite.polledAt.getTime()) / 3_600_000] : [];
        }).sort((a, b) => a - b);
        return ages.length ? ages[Math.floor(ages.length / 2)] : null;
      })(),
    };
  };
  // Does the arithmetic reconstruction (used nowhere for ROI) agree with the recorded quotes? A check on the stored no-vig, not a substitute.
  const recon = main_.flatMap((r) => {
    const o = opp.get(r)?.opposite;
    const rc = oppositePrice(r.price, r.market);
    return o && rc ? [Math.abs(impliedOf(o.priceAmerican) - impliedOf(rc.price))] : [];
  }).sort((a, b) => a - b);
  const p = byPeriod(main_);
  emit("INV", {
    nbaPropSettledAll: nba.length,
    voids: nba.filter((l) => l.result === "void").length,
    pushes: nba.filter((l) => l.result === "push").length,
    hitMiss: settled.length,
    duplicates: dups,
    noPrice: unique.filter((l) => l.features.price === null).length,
    frozenAtOrAfterTip: leaked.length,
    main: { ...span(main_), discovery: span(p.discovery), post: span(p.post), forward: span(p.forward) },
    alt: { ...span(alt), discovery: span(byPeriod(alt).discovery), post: span(byPeriod(alt).post), forward: span(byPeriod(alt).forward) },
    captured: {
      price: main_.filter((r) => r.price !== null).length,
      noVig: main_.filter((r) => r.market !== null).length,
      close: main_.filter((r) => r.close !== null).length,
      z: main_.filter((r) => r.zSide !== null).length,
      projMinutes: main_.filter((r) => r.projMinutes !== null).length,
      grade: main_.filter((r) => r.grade !== null).length,
      recordsFrozen: main_.filter((r) => r.ratesFrozen).length,
      injury: main_.filter((r) => r.lean.features.injury !== undefined).length,
      openingPrice: 0,
    },
    rebuilt: { records: main_.filter((r) => !r.ratesFrozen && r.rates).length, history: main_.filter((r) => r.games !== null).length, role: main_.filter((r) => r.starterShare !== null).length, minutesChange: main_.filter((r) => r.minutesChange !== null).length },
    oppositeCoverage: { main: coverage(main_), alt: coverage(alt), mainDiscovery: coverage(p.discovery), mainPost: coverage(p.post) },
    reconstructionCheck: { n: recon.length, medianAbsImpliedDiff: recon.length ? recon[Math.floor(recon.length / 2)] : null, p90: recon.length ? recon[Math.floor(recon.length * 0.9)] : null },
    gamesPerDay: Object.fromEntries([...new Set(main_.map((r) => r.day!))].sort().map((d) => [d, new Set(main_.filter((r) => r.day === d).map((r) => r.cluster)).size])),
  });
  console.log(`main-line picks ${main_.length} (${span(main_).games} games, ${span(main_).days} days) · alt ${alt.length} · frozen at/after tip ${leaked.length} · duplicates ${dups}`);
  console.log(`opposite quote at decision time: main ${coverage(main_).oppAtDecision}/${main_.length} · alt ${coverage(alt).oppAtDecision}/${alt.length}`);

  // ── PHASE 2: plus-money prices.
  const periods: Period[] = ["all", "discovery", "post", "forward"];
  for (const [kind, set] of [["main", main_], ["alt", alt]] as const) {
    const bp = byPeriod(set);
    for (const per of periods) {
      for (const b of PRICE_BUCKETS) seg(`price-${kind}`, per, b.label, bp[per].filter((r) => r.price !== null && b.test(r.price)));
      seg(`price-${kind}`, per, "+100 to +174 (combined)", bp[per].filter((r) => r.price !== null && PLUS_100_175(r.price)));
      seg(`price-${kind}`, per, "+100 and higher (all plus money)", bp[per].filter((r) => r.price !== null && r.price >= 100));
    }
  }

  // ── PHASE 3: projection distance.
  for (const per of periods) {
    const rs = p[per];
    for (const b of Z_BUCKETS) seg("z", per, b.label, rs.filter((r) => absZ(r) !== null && b.test(absZ(r)!)));
    seg("z", per, "|z| 0.35–0.75 (the earlier band)", rs.filter((r) => absZ(r) !== null && Z_035_075(absZ(r)!)));
    seg("z", per, "degenerate |z| > 6", rs.filter((r) => absZ(r) !== null && absZ(r)! > Z_DEGENERATE));
    const plus = rs.filter((r) => r.price !== null && r.price >= 100);
    const minus = rs.filter((r) => r.price !== null && r.price < 100);
    seg("z×price", per, "plus money · |z| 0.35–0.75", plus.filter((r) => absZ(r) !== null && Z_035_075(absZ(r)!)));
    seg("z×price", per, "plus money · other |z|", plus.filter((r) => absZ(r) !== null && !Z_035_075(absZ(r)!)));
    seg("z×price", per, "plus money · |z| 0.35+", plus.filter((r) => absZ(r) !== null && absZ(r)! >= 0.35 && absZ(r)! <= Z_DEGENERATE));
    seg("z×price", per, "minus money · |z| 0.35–0.75", minus.filter((r) => absZ(r) !== null && Z_035_075(absZ(r)!)));
    seg("z×price", per, "minus money · other |z|", minus.filter((r) => absZ(r) !== null && !Z_035_075(absZ(r)!)));
    seg("z×price", per, "+100 to +174 · |z| 0.35–0.75", rs.filter((r) => r.price !== null && PLUS_100_175(r.price) && absZ(r) !== null && Z_035_075(absZ(r)!)));
  }
  emit("CALIB", { k: "z-main-all", bins: Z_BUCKETS.map((b) => ({ label: b.label, ...calibration(main_.filter((r) => absZ(r) !== null && b.test(absZ(r)!)).map((r) => ({ p: r.p, won: r.won })), [0, 1])[0] })) });

  // ── PHASE 4: does each factor add information beyond the books' price?
  const withMkt = (rs: AuditRow[]) => rs.filter((r) => r.market !== null && r.market > 0 && r.market < 1);
  const STATS = [...new Set(main_.map((r) => r.stat))].sort();
  const factors: { key: string; label: string; x: (r: AuditRow) => number | null; retrospective?: boolean }[] = [
    { key: "absz", label: "Projection distance |z| (capped at 2)", x: (r) => (absZ(r) === null || absZ(r)! > Z_DEGENERATE ? null : Math.min(absZ(r)!, 2)) },
    { key: "plus", label: "Plus-money price (indicator)", x: (r) => (r.price === null ? null : r.price >= 100 ? 1 : 0) },
    { key: "vig", label: "Vig paid: price's implied chance − no-vig chance", x: (r) => (r.price === null || r.market === null ? null : (impliedOf(r.price) - r.market) * 10) },
    { key: "archr", label: "ARCHR's chance (centred at 50%)", x: (r) => (r.p - 0.5) * 10 },
    { key: "disagree", label: "ARCHR vs no-vig disagreement (logit)", x: (r) => (r.market === null ? null : logit(r.p) - logit(r.market)) },
    { key: "under", label: "Under (indicator)", x: (r) => (r.side === "under" ? 1 : 0) },
    ...STATS.map((s) => ({ key: `stat:${s}`, label: `Market: ${s} (indicator)`, x: (r: AuditRow) => (r.stat === s ? 1 : 0) })),
    { key: "mins", label: "Projected minutes (per 10, centred at 28)", x: (r) => (r.projMinutes === null ? null : (r.projMinutes - 28) / 10) },
    { key: "grade", label: "Confidence score (per 10, centred at 50; since Nov 12)", x: (r) => (r.grade === null ? null : (r.grade - 50) / 10) },
    ...(["l5", "l10", "l15", "szn"] as const).map((w) => ({ key: w, label: `${w.toUpperCase()} hit rate at the line (− 50%, 5+ games)`, x: (r: AuditRow) => (r.rates && r.rates[w][1] >= 5 ? r.rates[w][0] / r.rates[w][1] - 0.5 : null) })),
    { key: "history", label: "Games of history (log)", x: (r) => (r.games === null ? null : Math.log1p(r.games) - 4) },
    { key: "starter", label: "Starter share, last 10 (− 50%)", x: (r) => (r.starterShare === null ? null : r.starterShare - 0.5) },
    { key: "minchange", label: "Projected minus recent minutes (per 5)", x: (r) => (r.minutesChange === null ? null : r.minutesChange / 5) },
    { key: "clv", label: "Closing-line move toward the pick (RETROSPECTIVE ONLY)", x: (r) => (r.close === null || r.market === null ? null : (r.close - r.market) * 10), retrospective: true },
  ];
  const fr = (rs: AuditRow[], x: (r: AuditRow) => number | null): (FactorRow & { cluster: string })[] =>
    withMkt(rs).flatMap((r) => {
      const v = x(r);
      return v === null || !Number.isFinite(v) ? [] : [{ cluster: r.cluster, won: r.won, market: r.market!, x: [v] }];
    });
  const factorOut = factors.map((f) => {
    const allRows = fr(main_, f.x);
    const inSample = bootstrapCoef(allRows, (rs) => logisticWithOffset(rs.map((r) => ({ y: r.won, offset: logit(r.market), x: r.x })))?.[0] ?? null);
    const chrono = chronoFactorTest(fr(p.discovery, f.x), fr(p.post, f.x));
    return { key: f.key, label: f.label, retrospective: Boolean(f.retrospective), n: allRows.length, ...inSample, chrono };
  });
  const prospective = factorOut.filter((f) => !f.retrospective);
  const bhIn = benjaminiHochberg(prospective.map((f) => f.p), 0.1);
  const bhChrono = benjaminiHochberg(prospective.map((f) => f.chrono.pNoise), 0.1);
  prospective.forEach((f, i) => emit("FACTOR", { ...f, survivesFdrInSample: bhIn[i], survivesFdrChrono: bhChrono[i], tests: prospective.length }));
  factorOut.filter((f) => f.retrospective).forEach((f) => emit("FACTOR", { ...f, survivesFdrInSample: null, survivesFdrChrono: null, tests: prospective.length }));
  // A predeclared interpretable model: distance, disagreement, under, minutes change, L10 — trained on discovery, judged on post.
  const comboX = (r: AuditRow) => {
    const z = absZ(r);
    if (z === null || z > Z_DEGENERATE || r.market === null || r.minutesChange === null || !r.rates || r.rates.l10[1] < 5) return null;
    return [Math.min(z, 2), logit(r.p) - logit(r.market), r.side === "under" ? 1 : 0, r.minutesChange / 5, r.rates.l10[0] / r.rates.l10[1] - 0.5];
  };
  const comboRows = (rs: AuditRow[]) => withMkt(rs).flatMap((r) => (comboX(r) ? [{ cluster: r.cluster, won: r.won, market: r.market!, x: comboX(r)! }] : []));
  emit("COMBO", { label: "Combined: |z|, disagreement, under, minutes change, L10 (trained on discovery, judged on post)", ...chronoFactorTest(comboRows(p.discovery), comboRows(p.post)) });

  // ── PHASE 5: fades, at the opposite side's ACTUAL recorded price.
  const hyp: { key: string; label: string; test: (r: AuditRow) => boolean }[] = [
    { key: "ALL", label: "Every main-line pick (baseline)", test: () => true },
    { key: "A", label: "A · |z| above 0.75 (overconfident far projections)", test: (r) => absZ(r) !== null && absZ(r)! > 0.75 && absZ(r)! <= Z_DEGENERATE },
    { key: "B", label: "B · L10 hit rate above 80% (8+ games)", test: (r) => Boolean(r.rates && r.rates.l10[1] >= 8 && r.rates.l10[0] / r.rates.l10[1] > 0.8) },
    { key: "D", label: "D · assists, PRA, rebounds + assists", test: (r) => ["assists", "pointsReboundsAssists", "reboundsAssists"].includes(r.stat) },
    { key: "E", label: "E · ARCHR 5+ pts from the no-vig chance", test: (r) => r.market !== null && Math.abs(r.p - r.market) >= 0.05 },
    { key: "E2", label: "E · ARCHR 3+ pts from the no-vig chance", test: (r) => r.market !== null && Math.abs(r.p - r.market) >= 0.03 },
  ];
  for (const h of hyp) {
    for (const per of ["all", "discovery", "post"] as const) {
      const orig = p[per].filter(h.test);
      const fades = orig.flatMap((r) => {
        const o = opp.get(r);
        if (!o?.opposite || o.identityOk === false) return [];
        return [{ row: fadeRow(r, o.opposite.priceAmerican, o.sameSide?.priceAmerican ?? r.price!, o.closingOpposite && o.closingSame ? { opp: o.closingOpposite.priceAmerican, same: o.closingSame.priceAmerican } : null), pick: r }];
      });
      const origS = segmentPerf(orig, 29);
      const fadeS = segmentPerf(fades.map((f) => f.row), 31);
      emit("FADE", {
        key: h.key,
        label: h.label,
        period: per,
        original: origS,
        fade: fadeS,
        coverage: orig.length ? fades.length / orig.length : null,
        identityMismatches: orig.filter((r) => opp.get(r)?.identityOk === false).length,
        leaveOneDay: per === "all" ? leaveOneOut(fades.map((f) => f.row), (r) => r.day ?? "") : undefined,
        concentration: per === "all" ? profitConcentration(fades.map((f) => ({ ...f.row, player: f.pick.lean.features.playerId ?? "" })), (r) => r.player) : undefined,
      });
    }
  }
  // C · alternate lines: is there a complementary market at the same alt line? (Never assumed.)
  const altOpp = alt.filter((r) => opp.get(r)?.opposite);
  emit("ALTFADE", {
    altPicks: alt.length,
    withOppositeAtSameLine: altOpp.length,
    calibration: byPeriod(alt).all.length ? segmentPerf(alt, 37) : null,
    calibrationDiscovery: segmentPerf(byPeriod(alt).discovery, 37),
    calibrationPost: segmentPerf(byPeriod(alt).post, 37),
    fadeAtSameLine: altOpp.length ? segmentPerf(altOpp.map((r) => { const o = opp.get(r)!; return fadeRow(r, o.opposite!.priceAmerican, o.sameSide?.priceAmerican ?? r.price!, null); }), 41) : null,
  });
  // C2 · the "alternative line" strategy: when ARCHR also pushed an alt rung, fade its MAIN-line pick instead (a different bet, priced at its own recorded quote).
  const altKeys = new Set(alt.map((r) => `${r.cluster}|${r.lean.features.playerId}|${r.stat}`));
  for (const per of ["all", "discovery", "post"] as const) {
    const orig = p[per].filter((r) => altKeys.has(`${r.cluster}|${r.lean.features.playerId}|${r.stat}`));
    const fades = orig.flatMap((r) => {
      const o = opp.get(r);
      return o?.opposite && o.identityOk !== false ? [fadeRow(r, o.opposite.priceAmerican, o.sameSide?.priceAmerican ?? r.price!, o.closingOpposite && o.closingSame ? { opp: o.closingOpposite.priceAmerican, same: o.closingSame.priceAmerican } : null)] : [];
    });
    emit("FADE", { key: "C2", label: "C2 · main line opposite, where ARCHR also pushed an alt rung", period: per, original: segmentPerf(orig, 29), fade: segmentPerf(fades, 31), coverage: orig.length ? fades.length / orig.length : null, identityMismatches: 0 });
  }

  // ── PHASE 6: nested chronological split inside the post period (validation days, then test days) and sensitivity.
  const postDays = [...new Set(p.post.map((r) => r.day!))].sort();
  const valDays = new Set(postDays.slice(0, Math.ceil(postDays.length / 2)));
  const candidates: { key: string; label: string; test: (r: AuditRow) => boolean }[] = [
    { key: "plus-z", label: "Plus money · |z| 0.35–0.75", test: (r) => r.price !== null && r.price >= 100 && absZ(r) !== null && Z_035_075(absZ(r)!) },
    { key: "plus", label: "Plus money (+100 and higher)", test: (r) => r.price !== null && r.price >= 100 },
    { key: "z035", label: "|z| 0.35+ (distance-035-v1)", test: (r) => absZ(r) !== null && absZ(r)! >= 0.35 && absZ(r)! <= Z_DEGENERATE },
    { key: "z3575", label: "|z| 0.35–0.75", test: (r) => absZ(r) !== null && Z_035_075(absZ(r)!) },
    { key: "plus175-z", label: "+100 to +174 · |z| 0.35+", test: (r) => r.price !== null && PLUS_100_175(r.price) && absZ(r) !== null && absZ(r)! >= 0.35 && absZ(r)! <= Z_DEGENERATE },
    { key: "archr-ev", label: "Plus money · ARCHR expected value above 0", test: (r) => r.price !== null && r.price >= 100 && r.p * decimalOf(r.price) - 1 > 0 },
  ];
  for (const c of candidates) {
    const all_ = main_.filter(c.test);
    emit("CAND", {
      key: c.key,
      label: c.label,
      discovery: segmentPerf(p.discovery.filter(c.test), 43),
      validation: segmentPerf(p.post.filter((r) => valDays.has(r.day!) && c.test(r)), 43),
      test: segmentPerf(p.post.filter((r) => !valDays.has(r.day!) && c.test(r)), 43),
      post: segmentPerf(p.post.filter(c.test), 43),
      all: segmentPerf(all_, 43),
      leaveOneDay: leaveOneOut(all_, (r) => r.day ?? ""),
      leaveOnePlayerRange: (() => {
        const lo = leaveOneOut(all_, (r) => r.lean.features.playerId ?? "").map((x) => x.roi ?? 0);
        return lo.length ? { min: Math.min(...lo), max: Math.max(...lo), players: lo.length } : null;
      })(),
      concentration: profitConcentration(all_.map((r) => ({ ...r, player: r.lean.features.playerId ?? "" })), (r) => r.player),
      perSlate: slateFeasibility(p.post, c.test),
    });
  }
  emit("SPLIT", { validationDays: [...valDays], testDays: postDays.filter((d) => !valDays.has(d)) });

  // ── PHASE 7: where the model's errors come from (post-game reads: diagnosis only, never a pregame filter).
  const post = await attachNbaPostGame(main_.map((r) => r.lean));
  const postBy = new Map(post.map((l, i) => [main_[i]!, l]));
  const errs = main_.flatMap((r) => {
    const f = r.lean.features;
    const a = r.lean.actual;
    if (typeof f.projMean !== "number" || typeof f.projSd !== "number" || !(f.projSd > 0) || typeof a !== "number") return [];
    return [{ r, e: (a - f.projMean) / f.projSd, bias: a - f.projMean }];
  });
  const sdOf = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
  };
  const varianceRow = (label: string, es: typeof errs) =>
    es.length ? { label, n: es.length, meanZ: es.reduce((a, x) => a + x.e, 0) / es.length, sdZ: sdOf(es.map((x) => x.e)), outside196: es.filter((x) => Math.abs(x.e) > 1.96).length / es.length, meanBias: es.reduce((a, x) => a + x.bias, 0) / es.length } : { label, n: 0 };
  emit("VARIANCE", [varianceRow("all main lines", errs), ...STATS.map((s) => varianceRow(s, errs.filter((x) => x.r.stat === s))), ...Z_BUCKETS.map((b) => varianceRow(b.label, errs.filter((x) => absZ(x.r) !== null && b.test(absZ(x.r)!))))]);
  const minuteErr = main_.flatMap((r) => {
    const m = postBy.get(r)?.post?.minutes;
    return r.projMinutes !== null && typeof m === "number" ? [{ r, d: m - r.projMinutes }] : [];
  });
  emit("MINUTES", {
    n: minuteErr.length,
    meanError: minuteErr.length ? minuteErr.reduce((a, x) => a + x.d, 0) / minuteErr.length : null,
    mae: minuteErr.length ? minuteErr.reduce((a, x) => a + Math.abs(x.d), 0) / minuteErr.length : null,
    short6: segmentPerf(minuteErr.filter((x) => x.d <= -6).map((x) => x.r), 47),
    within: segmentPerf(minuteErr.filter((x) => Math.abs(x.d) < 6).map((x) => x.r), 47),
    long6: segmentPerf(minuteErr.filter((x) => x.d >= 6).map((x) => x.r), 47),
    overShort: segmentPerf(minuteErr.filter((x) => x.d <= -6 && x.r.side === "over").map((x) => x.r), 47),
    underLong: segmentPerf(minuteErr.filter((x) => x.d >= 6 && x.r.side === "under").map((x) => x.r), 47),
  });
  emit("LOSSES", { all: lossBreakdown(post), discovery: lossBreakdown(post.filter((_, i) => periodOf(main_[i]!) === "discovery")), post: lossBreakdown(post.filter((_, i) => periodOf(main_[i]!) === "post")) });
  // Correlated categories: residuals of the same player's different stats on one night vs different players in the same game.
  const samePlayer = (() => {
    const byPG = new Map<string, AuditRow[]>();
    for (const r of main_) {
      const k = `${r.cluster}|${r.lean.features.playerId}`;
      (byPG.get(k) ?? byPG.set(k, []).get(k)!).push(r);
    }
    let s = 0;
    let n = 0;
    for (const list of byPG.values())
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          const pa = a.market ?? a.p;
          const pb = b.market ?? b.p;
          s += ((a.won - pa) * (b.won - pb)) / Math.sqrt(pa * (1 - pa) * pb * (1 - pb));
          n++;
        }
    return { pairs: n, corr: n ? s / n : null };
  })();
  emit("CORR", { samePlayerSameGame: samePlayer, ...residualCorrelation(main_) });

  // ── PHASE 8: six plus-money selections a day?
  const standards: { key: string; label: string; test: (r: AuditRow) => boolean }[] = [
    { key: "S0", label: "Any plus-money main-line pick", test: (r) => r.price !== null && r.price >= 100 },
    { key: "S1", label: "Plus money · ARCHR's expected value above 0", test: (r) => r.price !== null && r.price >= 100 && r.p * decimalOf(r.price) - 1 > 0 },
    { key: "S2", label: "Plus money · ARCHR 2+ pts above the no-vig chance", test: (r) => r.price !== null && r.price >= 100 && r.market !== null && r.p - r.market >= 0.02 },
    { key: "S3", label: "Plus money · |z| 0.35+", test: (r) => r.price !== null && r.price >= 100 && absZ(r) !== null && absZ(r)! >= 0.35 && absZ(r)! <= Z_DEGENERATE },
  ];
  for (const s of standards) {
    for (const per of ["all", "discovery", "post"] as const) {
      const q = p[per].filter(s.test);
      const marketEv = q.filter((r) => r.market !== null && r.price !== null).map((r) => r.market! * decimalOf(r.price!) - 1);
      const archrEv = q.filter((r) => r.price !== null).map((r) => r.p * decimalOf(r.price!) - 1);
      const qtl = (xs: number[], k: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(k * xs.length))] : null);
      emit("SLATE", {
        key: s.key,
        label: s.label,
        period: per,
        feasibility: slateFeasibility(p[per], s.test, 6),
        perf: segmentPerf(q, 53),
        archrEv: { p10: qtl(archrEv, 0.1), median: qtl(archrEv, 0.5), p90: qtl(archrEv, 0.9) },
        marketEv: { p10: qtl(marketEv, 0.1), median: qtl(marketEv, 0.5), p90: qtl(marketEv, 0.9) },
        oppositeCoverage: q.length ? q.filter((r) => opp.get(r)?.opposite).length / q.length : null,
        corr: residualCorrelation(q),
      });
    }
  }
  console.log(`done · ${new Date().toISOString()} · window ${etDateOf(new Date(Math.min(...main_.map((r) => r.lean.startsAt.getTime()))))} → ${etDateOf(new Date(Math.max(...main_.map((r) => r.lean.startsAt.getTime()))))}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
