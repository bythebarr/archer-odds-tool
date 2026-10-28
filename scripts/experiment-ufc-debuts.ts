/**
 * How should the fight model treat debuts and short UFC careers? Replays every
 * bout under each variant of the replay (lib/ufc/fightModel.ts ReplayOptions)
 * and of the debut features, refits the logistic model on the oldest 60%, and
 * scores the newest 20% — overall and for bouts with a debutant or a fighter
 * on 1–2 UFC fights.
 *
 *   npx tsx scripts/experiment-ufc-debuts.ts
 */
import "dotenv/config";
import { loadUfcHistory } from "@/lib/ufc/fightData";
import { UfcReplay, type ReplayOptions } from "@/lib/ufc/fightModel";
import { fitLogistic, predictLogistic } from "@/lib/stats/logistic";

const ll = (p: number, y: number) => -(y ? Math.log(Math.max(1e-6, p)) : Math.log(Math.max(1e-6, 1 - p)));

type Extra = (a: { fights: number; age: number | null }, b: { fights: number; age: number | null }) => number[];
const EXTRAS: Record<string, Extra> = {
  none: () => [],
  // A debutant on either side.
  debut: (a, b) => [(a.fights === 0 ? 1 : 0) - (b.fights === 0 ? 1 : 0)],
  // A young debutant is a better signee than an old one.
  debutAge: (a, b) => [
    (a.fights === 0 ? 1 : 0) - (b.fights === 0 ? 1 : 0),
    (a.fights === 0 && a.age !== null ? a.age - 29 : 0) - (b.fights === 0 && b.age !== null ? b.age - 29 : 0),
  ],
};

async function main() {
  const h = await loadUfcHistory();
  const variants: [string, ReplayOptions, string][] = [
    ["live", {}, "none"],
    ...[60, 70, 85].flatMap((k) => [3, 5, 8].map((st) => [`roster -15 kNew ${k} settle ${st}`, { debutStart: "roster", debutOffset: -15, kNew: k, settledAfter: st }, "none"] as [string, ReplayOptions, string])),
  ];


  for (const [name, opts, extra] of variants) {
    const replay = new UfcReplay(h.fighters, h.bouts, opts);
    const rows: { x: number[]; y: 0 | 1; fa: number; fb: number }[] = [];
    for (const b of h.bouts) {
      if (b.winner === b.red || b.winner === b.blue) {
        const f = replay.features(b.red, b.blue, b.date, b.weightClass);
        rows.push({ x: [...f.x, ...EXTRAS[extra]!(f.a, f.b)], y: b.winner === b.red ? 1 : 0, fa: f.a.fights, fb: f.b.fights });
      }
      replay.update(b);
    }
    // Both corners, so the red corner carries no information.
    const both = rows.flatMap((r) => [r, { ...r, x: r.x.map((v) => -v), y: (1 - r.y) as 0 | 1, fa: r.fb, fb: r.fa }]);
    const n = rows.length;
    const train = both.slice(0, Math.floor(n * 0.6) * 2);
    const test = both.slice(Math.floor(n * 0.8) * 2).filter((_, i) => i % 2 === 0);
    const fit = fitLogistic(train.map((r) => r.x), train.map((r) => r.y), 10);
    const score = (sel: (r: (typeof test)[number]) => boolean) => {
      const t = test.filter(sel);
      return (t.reduce((a, r) => a + ll(predictLogistic(fit.coefficients, r.x), r.y), 0) / t.length).toFixed(4);
    };
    console.log(
      `${name.padEnd(30)} all ${score(() => true)} · debut ${score((r) => r.fa === 0 || r.fb === 0)} · 1–2 fights ${score((r) => Math.min(r.fa, r.fb) >= 1 && Math.min(r.fa, r.fb) <= 2)} · both 5+ ${score((r) => Math.min(r.fa, r.fb) >= 5)}`,
    );
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
