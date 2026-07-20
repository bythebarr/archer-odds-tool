import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { projectPropHit } from "@/lib/props/projection";

/**
 * Regenerate the season-progress ramp table for EVERY pitcher (stat, line) the
 * board offers — see pitcher_workload_ramp for the why. The bounded ramp
 * (cap=8) was validated out-of-sample in calibrate-pitcher-props.ts; this fits
 * the same form per board line on ALL starts and prints the table to paste into
 * src/lib/props/pitcherRamp.ts.
 *
 * Run: `npm run fit:pitcherramps`.
 */

const CAP = 8;
const BOARD_LINES: Record<string, number[]> = {
  strikeoutsPitching: [3.5, 4.5, 5.5, 6.5, 7.5],
  outsRecorded: [14.5, 15.5, 16.5, 17.5, 18.5, 19.5],
  earnedRuns: [1.5, 2.5, 3.5],
  hitsAllowed: [3.5, 4.5, 5.5, 6.5, 7.5],
  walksAllowed: [1.5, 2.5, 3.5],
};

interface Sample {
  hit: number;
  proj: number;
  seasonSample: number;
}

/** Lookahead-safe projected samples for one (column, line), default K/tilt, no ramp. */
function samplesFor(
  rows: { mlbPlayerId: string; gameDate: Date; value: number | null }[],
  line: number,
  base: number
): Sample[] {
  const out: Sample[] = [];
  let curPlayer = "";
  let curYear = -1;
  let seasonHits = 0;
  let seasonSample = 0;
  const recent: number[] = [];
  for (const g of rows) {
    if (g.value === null) continue;
    const year = g.gameDate.getUTCFullYear();
    if (g.mlbPlayerId !== curPlayer || year !== curYear) {
      curPlayer = g.mlbPlayerId;
      curYear = year;
      seasonHits = 0;
      seasonSample = 0;
      recent.length = 0;
    }
    const hit = g.value > line ? 1 : 0;
    if (seasonSample > 0) {
      const recentRate = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
      const proj = projectPropHit({ seasonHits, seasonSample, recentRate, baseRate: base });
      if (proj) out.push({ hit, proj: proj.probability, seasonSample });
    }
    seasonHits += hit;
    seasonSample += 1;
    recent.push(hit);
    if (recent.length > 10) recent.shift();
  }
  return out;
}

/** OLS of residual (hit − proj) on capped season progress → slope·(x − pivot). */
function fitRamp(samples: Sample[]): { slope: number; pivot: number } {
  const n = samples.length;
  if (n < 2) return { slope: 0, pivot: 0 };
  const x = (s: Sample) => Math.min(s.seasonSample, CAP);
  const mx = samples.reduce((a, s) => a + x(s), 0) / n;
  const my = samples.reduce((a, s) => a + (s.hit - s.proj), 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const s of samples) {
    sxy += (x(s) - mx) * (s.hit - s.proj - my);
    sxx += (x(s) - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const pivot = Math.abs(slope) > 1e-9 ? -intercept / slope : 0;
  return { slope, pivot };
}

async function main() {
  const starts = await prisma.playerGameLog.findMany({
    where: { isStarter: true },
    select: {
      mlbPlayerId: true,
      gameDate: true,
      strikeoutsPitching: true,
      outsRecorded: true,
      earnedRuns: true,
      hitsAllowed: true,
      walksAllowed: true,
    },
    orderBy: [{ mlbPlayerId: "asc" }, { gameDate: "asc" }],
  });
  console.log(`${starts.length} starts. cap=${CAP}. Paste into src/lib/props/pitcherRamp.ts:\n`);
  console.log("export const PITCHER_RAMPS: Record<string, { slope: number; pivot: number; cap: number }> = {");
  for (const [column, lines] of Object.entries(BOARD_LINES)) {
    for (const line of lines) {
      const rows = starts.map((s) => ({
        mlbPlayerId: s.mlbPlayerId,
        gameDate: s.gameDate,
        value: (s as unknown as Record<string, number | null>)[column],
      }));
      const qualified = rows.filter((r) => r.value !== null);
      if (!qualified.length) continue;
      const base = qualified.reduce((a, r) => a + (r.value! > line ? 1 : 0), 0) / qualified.length;
      const r = fitRamp(samplesFor(rows, line, base));
      console.log(`  "${column}:${line}": { slope: ${r.slope.toFixed(5)}, pivot: ${r.pivot.toFixed(2)}, cap: ${CAP} },`);
    }
  }
  console.log("};");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
