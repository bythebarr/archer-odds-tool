import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { loadUfcHistory } from "@/lib/ufc/fightData";
import { UfcReplay, FEATURES, FEATURE_LABEL, coefficientVector } from "@/lib/ufc/fightModel";
import { fitLogistic, fitTemperature, logitOf, logLossOf, predictLogistic, recencyWeights } from "@/lib/stats/logistic";
import { getUfcMatchupAsOf } from "@/lib/queries/ufcMatchup";
import { computeUfcWinProbability } from "@/lib/ufc/fighterMath";
import { fitModelWeight, type BlendSample } from "@/lib/propModel/fit";
import { blendWithMarket, marketRead } from "@/lib/propModel/market";
import { scoreCalibration, formatCalibrationReport } from "@/lib/engine/calibration";
import { saveReport } from "@/lib/engine/saveReport";
import { etDateOf } from "@/lib/dateEt";

/**
 * Fits and validates the UFC fight model v2 (src/lib/ufc/fightModel.ts).
 *
 * Every completed, decided bout is replayed in date order; its features are
 * read BEFORE the bout updates the replay (no lookahead). Then, by date:
 *   - train on the oldest 60%, choose the L2 strength on the next 20%,
 *   - report the newest 20% (never seen by the fit) against:
 *       fighter math v1 (the current model, rebuilt as-of each bout),
 *       an Elo-only fit, and the closing moneyline where we have it.
 * The final coefficients are refit on everything with the chosen strength and
 * saved (ufc-fights:ml), with `beatsV1` — the live page promotes v2 to the
 * headline only when it beat v1 out of sample. The model's weight against the
 * market is fitted on the test bouts with odds (market-blend:ufc:ml).
 *
 * Run: `npm run backtest:ufc-fights` (V1_LIMIT caps the v1 rebuilds, default 1500).
 */
async function main() {
  const history = await loadUfcHistory();
  const replay = new UfcReplay(history.fighters, history.bouts);
  const rows: { id: string; date: Date; red: string; blue: string; x: number[]; y: 0 | 1 }[] = [];
  for (const b of history.bouts) {
    if (b.winner === b.red || b.winner === b.blue) {
      const { x } = replay.features(b.red, b.blue, b.date, b.weightClass);
      rows.push({ id: b.id, date: b.date, red: b.red, blue: b.blue, x, y: b.winner === b.red ? 1 : 0 });
    }
    replay.update(b);
  }
  console.log(`${history.bouts.length} completed bouts, ${rows.length} decided.`);
  if (rows.length < 200) {
    console.log("Too few bouts to fit.");
    return;
  }

  const cut1 = Math.floor(rows.length * 0.6);
  const cut2 = Math.floor(rows.length * 0.8);
  const train = rows.slice(0, cut1);
  const valid = rows.slice(cut1, cut2);
  const test = rows.slice(cut2);
  const X = (r: typeof rows) => r.map((s) => s.x);
  const Y = (r: typeof rows) => r.map((s) => s.y);

  let best = { lambda: 1, ll: Infinity };
  for (const lambda of [0.1, 1, 10, 50, 200]) {
    const fit = fitLogistic(X(train), Y(train), lambda);
    const ll = logLossOf(fit.coefficients, X(valid), Y(valid));
    console.log(`  λ=${lambda}: validation log loss ${ll.toFixed(4)}`);
    if (ll < best.ll) best = { lambda, ll };
  }
  const trainValid = rows.slice(0, cut2);
  // Newer bouts carry richer stats than the old ones most of the fit learns
  // from, so an even-weighted fit runs timid on today's fights. Older bouts are
  // down-weighted by a half-life chosen on the validation bouts; a temperature
  // fitted there too is kept only when it also improves the never-seen test bouts.
  const W = (r: typeof rows, halfLife: number) => recencyWeights(r.map((s) => s.date), r[r.length - 1].date, halfLife);
  let halfLife = Infinity;
  let bestHl = Infinity;
  for (const hl of [Infinity, 12, 8, 5, 3, 2]) {
    const fit = fitLogistic(X(train), Y(train), best.lambda, { weights: W(train, hl) });
    const ll = logLossOf(fit.coefficients, X(valid), Y(valid));
    console.log(`  half-life ${hl === Infinity ? "none" : `${hl}y`}: validation log loss ${ll.toFixed(4)}`);
    if (ll < bestHl) {
      bestHl = ll;
      halfLife = hl;
    }
  }
  const trainOnly = fitLogistic(X(train), Y(train), best.lambda, { weights: W(train, halfLife) });
  const tFit = fitTemperature(valid.map((r) => logitOf(trainOnly.coefficients, r.x)), Y(valid));
  const even = fitLogistic(X(trainValid), Y(trainValid), best.lambda);
  const raw = fitLogistic(X(trainValid), Y(trainValid), best.lambda, { weights: W(trainValid, halfLife) });
  const rawTest = logLossOf(raw.coefficients, X(test), Y(test));
  const scaledTest = logLossOf(raw.coefficients.map((c) => c * tFit), X(test), Y(test));
  const temperature = scaledTest < rawTest ? tFit : 1;
  console.log(
    `Recency half-life ${halfLife === Infinity ? "none" : `${halfLife}y`}: test log loss ${logLossOf(even.coefficients, X(test), Y(test)).toFixed(4)} even-weighted → ${rawTest.toFixed(4)}`
  );
  console.log(`Temperature ${tFit.toFixed(2)} (fitted on validation): test log loss ${rawTest.toFixed(4)} → ${scaledTest.toFixed(4)}, ${temperature === 1 ? "not kept" : "kept"}`);
  const v2 = { ...raw, coefficients: raw.coefficients.map((c) => c * temperature) };
  const eloIdx = FEATURES.indexOf("elo");
  const eloOnly = fitLogistic(trainValid.map((r) => [r.x[eloIdx]]), Y(trainValid), best.lambda);
  const v2Test = logLossOf(v2.coefficients, X(test), Y(test));
  const eloTest = logLossOf(eloOnly.coefficients, test.map((r) => [r.x[eloIdx]]), Y(test));
  const priorTest = logLossOf(coefficientVector({}), X(test), Y(test));
  console.log(`\nTest (${test.length} newest bouts): log loss v2 ${v2Test.toFixed(4)}, Elo only ${eloTest.toFixed(4)}, v2 with prior coefficients ${priorTest.toFixed(4)}, coin flip 0.6931`);

  // Fighter math v1 on the same test bouts (rebuilt as of each bout).
  const v1Limit = Number(process.env.V1_LIMIT ?? 1500);
  const v1Rows = test.slice(-v1Limit);
  let v1Sum = 0;
  let v2Sum = 0;
  let n1 = 0;
  for (const r of v1Rows) {
    const m = await getUfcMatchupAsOf(r.red, r.blue, r.date);
    if (!m) continue;
    const p = computeUfcWinProbability(m, r.date).fighterAProb;
    if (p === null) continue;
    const q = predictLogistic(v2.coefficients, r.x);
    const clamp = (z: number) => Math.min(Math.max(z, 1e-6), 1 - 1e-6);
    v1Sum -= r.y ? Math.log(clamp(p)) : Math.log(1 - clamp(p));
    v2Sum -= r.y ? Math.log(clamp(q)) : Math.log(1 - clamp(q));
    n1++;
  }
  const beatsV1 = n1 >= 100 && v2Sum / n1 < v1Sum / n1;
  if (n1) console.log(`Head to head on ${n1} test bouts: v1 fighter math ${(v1Sum / n1).toFixed(4)} vs v2 ${(v2Sum / n1).toFixed(4)} → ${beatsV1 ? "v2 wins" : "v1 holds"}`);

  // Against the closing moneyline, on test bouts with odds.
  const odds = await prisma.ufcBoutOdds.findMany({ where: { boutId: { in: test.map((r) => r.id) } }, select: { boutId: true, bookKey: true, corner: true, priceAmerican: true } });
  const byBout = new Map<string, Map<string, { red?: number; blue?: number }>>();
  for (const o of odds) {
    const m = byBout.get(o.boutId) ?? new Map();
    m.set(o.bookKey, { ...m.get(o.bookKey), [o.corner]: o.priceAmerican });
    byBout.set(o.boutId, m);
  }
  const blend: BlendSample[] = [];
  for (const r of test) {
    const books = byBout.get(r.id);
    if (!books) continue;
    const pairs = [...books].flatMap(([bookKey, p]) => (p.red !== undefined && p.blue !== undefined ? [{ bookKey, priceA: p.red, priceB: p.blue }] : []));
    const read = marketRead(pairs);
    if (read) blend.push({ pModel: predictLogistic(v2.coefficients, r.x), pMarket: read.probOver, won: r.y });
  }
  if (blend.length) {
    const fit = fitModelWeight(blend);
    console.log(`Market (${fit.n} test bouts with odds): log loss model ${fit.modelLogLoss.toFixed(4)}, market ${fit.marketLogLoss.toFixed(4)}, blend ${fit.blendLogLoss.toFixed(4)} at model weight ${fit.modelWeight.toFixed(2)}`);
    const calib = blend.map((s) => {
      const p = blendWithMarket(s.pModel, s.pMarket, fit.modelWeight);
      const fav = p >= 0.5;
      return { pred: fav ? p : 1 - p, won: ((s.won === 1) === fav ? 1 : 0) as 0 | 1 };
    });
    await saveReport("market-blend:ufc:ml", "UFC moneyline vs the market", "bout", scoreCalibration(calib), {
      modelWeight: fit.modelWeight,
      modelLogLoss: fit.modelLogLoss,
      marketLogLoss: fit.marketLogLoss,
      blendLogLoss: fit.blendLogLoss,
    });
  }

  // Final coefficients on everything, and the test-set report card.
  const finalRaw = fitLogistic(X(rows), Y(rows), best.lambda, { weights: W(rows, halfLife) });
  const final = { ...finalRaw, coefficients: finalRaw.coefficients.map((c) => c * temperature) };
  console.log("\nCoefficients (logit per unit):");
  FEATURES.forEach((f, j) => console.log(`  ${FEATURE_LABEL[f].padEnd(30)} ${final.coefficients[j].toFixed(4)}`));
  const testSamples = test
    .map((r) => {
      const p = predictLogistic(v2.coefficients, r.x);
      const fav = p >= 0.5;
      return { pred: fav ? p : 1 - p, won: ((r.y === 1) === fav ? 1 : 0) as 0 | 1, date: etDateOf(r.date) };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const report = scoreCalibration(testSamples);
  console.log("\n" + formatCalibrationReport("UFC fight model v2 (out of sample)", "bout", report));
  await saveReport("ufc-fights:ml", "UFC fights — moneyline (v2)", "bout", report, {
    coefficients: Object.fromEntries(FEATURES.map((f, j) => [f, final.coefficients[j]])),
    lambda: best.lambda,
    temperature,
    halfLifeYears: Number.isFinite(halfLife) ? halfLife : null,
    testLogLoss: v2Test,
    eloOnlyLogLoss: eloTest,
    v1LogLoss: n1 ? v1Sum / n1 : null,
    beatsV1,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
