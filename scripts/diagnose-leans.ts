import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { captureLeans } from "@/lib/tracking/capture";
import { loadGradedLeans } from "@/lib/queries/edgeReport";
import { evaluateLeans } from "@/lib/tracking/evaluate";

/**
 * Read-only: the leans pick tracking would capture for games in the next 36
 * hours (nothing is written), and the edge report so far.
 * Run: `npm run diagnose:leans`.
 */
async function main() {
  const t = Date.now();
  const out = await captureLeans(new Date(), { dryRun: true, hours: 36 });
  console.log(`Dry-run capture (next 36 h) in ${Date.now() - t} ms:`);
  for (const [model, r] of Object.entries(out)) {
    if ("error" in r) {
      console.log(`  ${model}: ERROR ${r.error}`);
      continue;
    }
    console.log(`  ${model}: ${r.games} games, ${r.leans} leans`);
    for (const l of r.sample ?? []) console.log(`     ${l.features.label} · ARCHR ${(l.prob * 100).toFixed(1)}% · market ${l.features.marketProb === null ? "—" : (l.features.marketProb * 100).toFixed(1) + "%"} · ${l.features.price ?? "no price"} ${l.features.book ?? ""}`);
  }
  const leans = await loadGradedLeans(240).catch((e: unknown) => {
    console.log(`\nNo settlement table yet (deploy pending?): ${String(e).slice(0, 120)}`);
    return [];
  });
  const report = evaluateLeans(leans);
  console.log(`\nGraded so far: ${report.overall.n} (${report.overall.verdict})`);
  for (const d of report.dimensions) {
    console.log(`  ${d.label}:`);
    for (const s of d.segments.slice(0, 8)) console.log(`     ${s.label.padEnd(36)} n ${String(s.n).padStart(5)} hit ${(s.hitRate * 100).toFixed(1)}% said ${(s.expected * 100).toFixed(1)}% ROI ${(s.roi * 100).toFixed(1)}% · ${s.verdict}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
