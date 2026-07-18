import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { projectPropHit } from "@/lib/props/projection";
import { buildTeamKRateModel, opponentTrailingKRate, pitcherKContextShift } from "@/lib/props/opponentKRate";
import { buildParkKRateModel, parkTrailingKRate, pitcherKParkShift } from "@/lib/props/parkKRate";

/**
 * Does DAYS OF REST move the pitcher-K residual, on top of everything wired?
 *
 * A common belief: extra rest = fresher = more strikeouts; short rest = fatigue =
 * fewer. This tests it against the FULL production baseline (ramp + opponent +
 * park) — so rest only counts if it adds something those three miss.
 *
 * Rest = days since the pitcher's previous start (lookahead-safe; known pre-game).
 * Bucketed, because rest is non-linear (5 days is the standard; ≤4 is short, ≥6 is
 * extra) and a linear term would smear those. Residual = actual − projection, in
 * points; a flat pattern across buckets = no signal to wire.
 *
 * Run: `npm run matchup:rest`.
 */

const RAMP: Record<string, { slope: number; pivot: number; cap: number }> = {
  "4.5": { slope: 0.01766, pivot: 5.0, cap: 8 },
  "5.5": { slope: 0.01457, pivot: 5.14, cap: 8 },
  "6.5": { slope: 0.01407, pivot: 5.31, cap: 8 },
};
const LINES = [4.5, 5.5, 6.5];

function restBucket(days: number): string {
  if (days <= 4) return "short ≤4";
  if (days === 5) return "normal 5";
  if (days === 6) return "extra 6";
  return "long ≥7";
}
const BUCKETS = ["short ≤4", "normal 5", "extra 6", "long ≥7"];

async function main() {
  console.log("Loading batting logs (opponent + park models)…");
  const batting = await prisma.playerGameLog.findMany({
    where: { plateAppearances: { not: null } },
    select: { teamId: true, gameDate: true, strikeoutsBatting: true, plateAppearances: true, game: { select: { homeTeamId: true } } },
  });
  const teamModel = buildTeamKRateModel(batting);
  const parkModel = buildParkKRateModel(batting.map((r) => ({ park: r.game?.homeTeamId, gameDate: r.gameDate, strikeoutsBatting: r.strikeoutsBatting, plateAppearances: r.plateAppearances })));
  const leagueRate = teamModel.leagueRate;

  console.log("Loading starts…");
  const starts = await prisma.playerGameLog.findMany({
    where: { isStarter: true },
    select: {
      mlbPlayerId: true,
      gameDate: true,
      strikeoutsPitching: true,
      isHome: true,
      game: { select: { homeTeamId: true, awayTeamId: true } },
    },
    orderBy: [{ mlbPlayerId: "asc" }, { gameDate: "asc" }],
  });

  const baseByLine = new Map<number, number>();
  for (const line of LINES) {
    const vals = starts.filter((s) => s.strikeoutsPitching !== null);
    baseByLine.set(line, vals.reduce((a, s) => a + (s.strikeoutsPitching! > line ? 1 : 0), 0) / vals.length);
  }

  // residual accumulators: line → bucket → {sum, n}
  const acc = new Map<number, Map<string, { sum: number; n: number }>>();
  for (const line of LINES) {
    acc.set(line, new Map(BUCKETS.map((b) => [b, { sum: 0, n: 0 }])));
  }
  // Deep-dive collector for the extended-rest (≥7) lead, line o5.5: keep each
  // row so we can OOS-validate a bonus and check the All-Star-break confound.
  const long55: { hit: number; proj: number; date: Date; july: boolean }[] = [];

  let curPlayer = "";
  let curYear = -1;
  let seasonHits: Record<number, number> = {};
  let seasonSample = 0;
  let recent: Record<number, number[]> = {};
  let prevDate: Date | null = null;
  for (const s of starts) {
    if (s.strikeoutsPitching === null) continue;
    const year = s.gameDate.getUTCFullYear();
    if (s.mlbPlayerId !== curPlayer || year !== curYear) {
      curPlayer = s.mlbPlayerId;
      curYear = year;
      seasonHits = {};
      seasonSample = 0;
      recent = {};
      prevDate = null;
      for (const line of LINES) {
        seasonHits[line] = 0;
        recent[line] = [];
      }
    }

    const restDays = prevDate ? Math.round((s.gameDate.getTime() - prevDate.getTime()) / 864e5) : null;
    const oppTeamId = s.isHome ? s.game?.awayTeamId : s.game?.homeTeamId;
    const oppRate = opponentTrailingKRate(teamModel, oppTeamId, s.gameDate);
    const parkRate = parkTrailingKRate(parkModel, s.game?.homeTeamId, s.gameDate);

    // Only rows with a real, in-range rest gap (2–10 days; skips season openers,
    // IL returns, doubleheaders that would masquerade as "rest").
    if (seasonSample > 0 && restDays !== null && restDays >= 2 && restDays <= 10) {
      const bucket = restBucket(restDays);
      for (const line of LINES) {
        const rr = recent[line];
        const recentRate = rr.length ? rr.reduce((a, b) => a + b, 0) / rr.length : null;
        const proj = projectPropHit(
          { seasonHits: seasonHits[line], seasonSample, recentRate, baseRate: baseByLine.get(line)! },
          { ramp: RAMP[String(line)], contextShift: pitcherKContextShift(line, oppRate, leagueRate) + pitcherKParkShift(line, parkRate, leagueRate) }
        );
        if (proj) {
          const hit = s.strikeoutsPitching > line ? 1 : 0;
          const cell = acc.get(line)!.get(bucket)!;
          cell.sum += hit - proj.probability;
          cell.n += 1;
          if (line === 5.5 && bucket === "long ≥7") {
            // All-Star break lands ~Jul 11–18; flag mid-to-late July as the
            // calendar window extended rest clusters in.
            const m = s.gameDate.getUTCMonth();
            const day = s.gameDate.getUTCDate();
            long55.push({ hit, proj: proj.probability, date: s.gameDate, july: m === 6 && day >= 8 && day <= 22 });
          }
        }
      }
    }
    for (const line of LINES) {
      const h = s.strikeoutsPitching > line ? 1 : 0;
      seasonHits[line] += h;
      recent[line].push(h);
      if (recent[line].length > 10) recent[line].shift();
    }
    seasonSample += 1;
    prevDate = s.gameDate;
  }

  console.log("\nPitcher-K residual (actual − full-baseline projection, pts) by days of rest:");
  console.log("line".padEnd(8) + BUCKETS.map((b) => b.padStart(13)).join("") + "spread".padStart(10));
  for (const line of LINES) {
    const cells = BUCKETS.map((b) => acc.get(line)!.get(b)!);
    const gaps = cells.map((c) => (c.n ? (c.sum / c.n) * 100 : NaN));
    const finite = gaps.filter((g) => !Number.isNaN(g));
    const spread = Math.max(...finite) - Math.min(...finite);
    console.log(
      `o${line}`.padEnd(8) +
        gaps.map((g, i) => (Number.isNaN(g) ? "—" : `${g >= 0 ? "+" : ""}${g.toFixed(1)} (${cells[i].n})`).padStart(13)).join("") +
        spread.toFixed(1).padStart(10)
    );
  }
  console.log("\n(A flat pattern / small spread across rest buckets = rest adds nothing over ramp+opponent+park. A monotonic short→long climb would be a real fatigue/freshness signal.)");

  // ── Deep-dive on the extended-rest (≥7) lead, o5.5 ───────────────────────
  console.log(`\nExtended-rest (≥7d) lead — o5.5 deep dive (n=${long55.length}):`);

  // (A) Calendar confound: is the bonus just the All-Star-break window?
  const july = long55.filter((r) => r.july);
  const other = long55.filter((r) => !r.july);
  const meanResid = (rows: typeof long55) => (rows.length ? (rows.reduce((a, r) => a + (r.hit - r.proj), 0) / rows.length) * 100 : NaN);
  const maxDate = long55.reduce((m, r) => (r.date > m ? r.date : m), new Date(0));
  console.log(
    `  (A) calendar:  All-Star window (Jul 8–22) ${meanResid(july).toFixed(1)}pt (n=${july.length})  vs  rest of season ${meanResid(other).toFixed(1)}pt (n=${other.length})`
  );
  if (july.length === 0) {
    console.log(
      `      ⚠ UNTESTABLE: 0 extended-rest starts in the break window — the data ends ${maxDate.toISOString().slice(0, 10)}` +
        ` (single partial season, pre-break). The calendar confound is NOT ruled out, just uncovered.`
    );
  } else {
    console.log(`      → if the edge lives only in the July window, it's the break confound, not freshness.`);
  }

  // (B) OOS: fit one bonus on older 70%, validate Brier on newer 30%.
  const sorted = [...long55].sort((a, b) => a.date.getTime() - b.date.getTime());
  const cut = Math.floor(sorted.length * 0.7);
  const train = sorted.slice(0, cut);
  const val = sorted.slice(cut);
  const bonus = train.length ? train.reduce((a, r) => a + (r.hit - r.proj), 0) / train.length : 0;
  const clamp = (p: number) => Math.min(Math.max(p, 0.02), 0.98);
  const brier = (fn: (r: (typeof long55)[number]) => number) => val.reduce((a, r) => a + (fn(r) - r.hit) ** 2, 0) / val.length;
  const bd = brier((r) => r.proj);
  const ba = brier((r) => clamp(r.proj + bonus));
  console.log(
    `  (B) OOS bonus:  train ${(bonus * 100).toFixed(1)}pt  →  val Brier ${bd.toFixed(4)} → ${ba.toFixed(4)}  (${ba < bd ? "IMPROVES" : "no gain"})`
  );
  console.log(`      → wire only if the edge survives OUTSIDE July AND improves OOS Brier.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
