import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { projectPropHit } from "@/lib/props/projection";
import { weatherRunsShift } from "@/lib/archer/weatherEffect";
import { fetchHistoricalWeather } from "@/lib/mlb/weatherApi";

/**
 * Does park weather (temperature + direction-aware wind) explain batter-prop
 * residuals (home runs / total bases)? This session built weatherRunsShift
 * for the game-line model (expectedRuns.ts) but never tested it against
 * player props — a hot, wind-blowing-out day should raise HR/TB probability
 * at the individual plate-appearance level if the effect that moves
 * team-level expected runs also shows up there. Genuinely untested territory.
 *
 * Reuses weatherRunsShift (archer/weatherEffect.ts) UNCHANGED as the single
 * candidate signal — not decomposed into separate temp/wind terms, since
 * that function is already the validated-by-construction (hand-verified
 * worked-example-tested) combination the game-line model uses. A passing
 * result here is directly consistent with what's already live, not a
 * competing re-derivation.
 *
 * PREREQUISITES this script needs but does not itself build:
 *   1. Game.venueId populated for historical games. No separate backfill
 *      script exists or is needed — syncMlbSchedule (src/lib/mlb/
 *      syncSchedule.ts) already upserts Venue + sets Game.venueId as a side
 *      effect of this session's weather feature. Re-run it over the full
 *      historical range first: `npm run sync:schedule` accepts start/end
 *      via the underlying function, or hit the deployed
 *      /api/cron/sync-schedule?start=&end= override documented for exactly
 *      this one-time-historical-backfill purpose.
 *   2. Real historical weather — fetched live, per distinct (venue, hour),
 *      from Open-Meteo's archive API (confirmed live during this session's
 *      weather-feature research: decades of real hourly reanalysis data,
 *      unlike the MLB Stats API splits endpoint used for platoon, which has
 *      no historical time series at all — this signal genuinely CAN be
 *      backtested). Deduplicated across games sharing a park/date, with a
 *      politeness delay between calls (same DELAY_MS convention
 *      scripts/backfill-player-game-logs.ts already uses for its own
 *      per-item live API calls).
 *
 * Only studies games at open-air venues (roofType === "Open") — a
 * retractable/dome game is excluded, not included-and-diluted, since
 * weatherRunsShift is defined to be exactly zero there and contributes no
 * information either way.
 *
 * PA-confound check included per this codebase's mandatory rule for every
 * matchup study, though weather has no obvious PA-inflation mechanism the
 * way platoon (pinch-hitting) or a high-offense park (extra trips through
 * the order) do — reported for honesty, not because a strong confound is
 * expected.
 *
 * Lookahead-safe: weather is the REAL historical reading at first pitch
 * (not a forecast-with-error — the actual thing that happened), which is
 * the correct lookahead-safe target for a backtest (a live forecast is only
 * an estimate OF this); the batter projection uses only his own prior
 * games this season.
 *
 * Run: `npm run matchup:weatherprops` (after the venue backfill above).
 */

const DELAY_MS = 150; // politeness delay between Open-Meteo archive calls, matching backfill-player-game-logs.ts's convention

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Row {
  hit: number;
  proj: number;
  weatherShift: number; // 0 if unknown or the venue's roof isn't Open
  pa: number;
  date: Date;
}

function reportSignal(rows: Row[], base: number): void {
  const withSignal = rows.filter((r) => r.weatherShift !== 0).sort((a, b) => a.weatherShift - b.weatherShift);
  if (withSignal.length < 30) {
    console.log(`  Too few rows with a resolved weather signal (n=${withSignal.length}) — skipping.`);
    return;
  }
  const t = Math.floor(withSignal.length / 3);
  const buckets = [withSignal.slice(0, t), withSignal.slice(t, 2 * t), withSignal.slice(2 * t)];
  const gaps = buckets.map((bk) => (bk.reduce((a, r) => a + (r.hit - r.proj), 0) / bk.length) * 100);
  const paLo = buckets[0].reduce((a, r) => a + r.pa, 0) / buckets[0].length;
  const paHi = buckets[2].reduce((a, r) => a + r.pa, 0) / buckets[2].length;

  const sorted = [...withSignal].sort((a, b) => a.date.getTime() - b.date.getTime());
  const cut = Math.floor(sorted.length * 0.7);
  const train = sorted.slice(0, cut);
  const val = sorted.slice(cut);
  let sxy = 0;
  let sxx = 0;
  for (const r of train) {
    sxy += r.weatherShift * (r.hit - r.proj);
    sxx += r.weatherShift * r.weatherShift;
  }
  const beta = sxx > 0 ? sxy / sxx : 0;
  const clamp = (p: number) => Math.min(Math.max(p, 0.02), 0.98);
  const brier = (fn: (r: Row) => number) => val.reduce((a, r) => a + (fn(r) - r.hit) ** 2, 0) / val.length;
  const bd = brier((r) => r.proj);
  const ba = brier((r) => clamp(r.proj + beta * r.weatherShift));
  const HOLD = 0.06;
  const roiF1 = (fn: (r: Row) => number) => {
    let staked = 0;
    let pnl = 0;
    for (const r of val) {
      const p = fn(r);
      if (Math.abs(p - base) < 0.03) continue;
      const over = p - base > 0;
      const implied = over ? p : 1 - p;
      if (implied <= 0 || implied >= 1) continue;
      const dec = 1 / (implied * (1 + HOLD));
      const won = over ? r.hit === 1 : r.hit === 0;
      staked += 1;
      pnl += won ? dec - 1 : -1;
    }
    return staked ? (pnl / staked) * 100 : NaN;
  };
  const rd = roiF1((r) => r.proj);
  const ra = roiF1((r) => clamp(r.proj + beta * r.weatherShift));
  let axy = 0;
  let axx = 0;
  for (const r of withSignal) {
    axy += r.weatherShift * (r.hit - r.proj);
    axx += r.weatherShift * r.weatherShift;
  }
  const betaAll = axx > 0 ? axy / axx : 0;

  console.log(`  n=${withSignal.length}`);
  console.log(
    `  residual by tercile:  cold/in ${gaps[0].toFixed(1)}   mid ${gaps[1].toFixed(1)}   hot/out ${gaps[2].toFixed(1)}   spread ${(gaps[2] - gaps[0]).toFixed(1)}pt`
  );
  console.log(`  PA-confound probe:  low-shift ${paLo.toFixed(2)} PA/g vs high-shift ${paHi.toFixed(2)} PA/g  (Δ ${(paHi - paLo).toFixed(2)})`);
  console.log(
    `  OOS: beta ${beta.toFixed(3)}   val Brier ${bd.toFixed(4)} → ${ba.toFixed(4)} (${ba < bd ? "IMPROVES" : "no gain"})   f=1 ROI ${rd >= 0 ? "+" : ""}${rd.toFixed(1)}% → ${ra >= 0 ? "+" : ""}${ra.toFixed(1)}%`
  );
  console.log(`  all-data beta (for wiring): ${betaAll.toFixed(4)}`);
}

async function main() {
  console.log("Loading batting logs with resolved open-air venues…");
  const batting = await prisma.playerGameLog.findMany({
    where: { plateAppearances: { not: null } },
    select: {
      mlbPlayerId: true,
      gameDate: true,
      hits: true,
      totalBases: true,
      homeRuns: true,
      plateAppearances: true,
      game: {
        select: {
          scheduledStartUtc: true,
          venue: { select: { latitude: true, longitude: true, azimuthDeg: true, roofType: true } },
        },
      },
    },
    orderBy: [{ mlbPlayerId: "asc" }, { gameDate: "asc" }],
  });
  if (batting.length === 0) {
    console.log("0 batting games found in the archive — nothing to study. Run this against a database with real historical PlayerGameLog data.");
    return;
  }

  const openAirCount = batting.filter((b) => b.game?.venue?.roofType === "Open").length;
  if (openAirCount === 0) {
    console.log(
      "0 games have a resolved open-air venue — run syncMlbSchedule over the historical date range first (see this file's header comment) before running this study."
    );
    return;
  }
  console.log(`${openAirCount} of ${batting.length} rows are at a resolved open-air venue.\n`);

  // Fetch real historical weather once per distinct (venue, hour) — many
  // games share a park on nearby dates, so this is far fewer calls than rows.
  console.log("Fetching historical weather from Open-Meteo's archive API (one call per distinct venue+hour, politely spaced)…");
  const weatherByKey = new Map<string, { temperatureF: number; windMph: number; windFromDeg: number } | null>();
  let fetched = 0;
  for (const b of batting) {
    const venue = b.game?.venue;
    const atUtc = b.game?.scheduledStartUtc;
    if (!venue || venue.roofType !== "Open" || !atUtc) continue;
    const key = `${venue.latitude},${venue.longitude}|${atUtc.toISOString().slice(0, 13)}`; // hour resolution
    if (weatherByKey.has(key)) continue;
    try {
      const weather = await fetchHistoricalWeather(venue.latitude, venue.longitude, atUtc);
      weatherByKey.set(key, weather);
    } catch (err) {
      console.error(`  weather fetch failed for ${key}:`, err instanceof Error ? err.message : err);
      weatherByKey.set(key, null);
    }
    fetched++;
    if (fetched % 50 === 0) console.log(`  ${fetched} distinct venue+hours fetched…`);
    await sleep(DELAY_MS);
  }
  console.log(`Fetched weather for ${weatherByKey.size} distinct venue+hours.\n`);

  const PROPS = [
    { label: "Home Runs o0.5", col: "homeRuns" as const, line: 0.5 },
    { label: "Total Bases o1.5", col: "totalBases" as const, line: 1.5 },
    { label: "Hits o0.5 (expected null — weather affects carry, not contact rate)", col: "hits" as const, line: 0.5 },
  ];

  for (const P of PROPS) {
    const base = batting.reduce((a, r) => a + ((r[P.col] ?? 0) > P.line ? 1 : 0), 0) / batting.length;
    const rows: Row[] = [];

    let curPlayer = "";
    let curYear = -1;
    let seasonHits = 0;
    let seasonSample = 0;
    const recent: number[] = [];
    for (const b of batting) {
      const year = b.gameDate.getUTCFullYear();
      if (b.mlbPlayerId !== curPlayer || year !== curYear) {
        curPlayer = b.mlbPlayerId;
        curYear = year;
        seasonHits = 0;
        seasonSample = 0;
        recent.length = 0;
      }
      const hit = (b[P.col] ?? 0) > P.line ? 1 : 0;

      const venue = b.game?.venue;
      const atUtc = b.game?.scheduledStartUtc;
      let weatherShift = 0;
      if (venue && venue.roofType === "Open" && atUtc) {
        const key = `${venue.latitude},${venue.longitude}|${atUtc.toISOString().slice(0, 13)}`;
        const weather = weatherByKey.get(key) ?? null;
        weatherShift = weatherRunsShift(
          weather
            ? {
                temperatureF: weather.temperatureF,
                windMph: weather.windMph,
                windFromDeg: weather.windFromDeg,
                venueAzimuthDeg: venue.azimuthDeg,
                roofType: venue.roofType,
              }
            : null
        );
      }

      if (seasonSample > 0) {
        const recentRate = recent.length ? recent.reduce((a, x) => a + x, 0) / recent.length : null;
        const proj = projectPropHit({ seasonHits, seasonSample, recentRate, baseRate: base });
        if (proj) rows.push({ hit, proj: proj.probability, weatherShift, pa: b.plateAppearances ?? 0, date: b.gameDate });
      }
      seasonHits += hit;
      seasonSample += 1;
      recent.push(hit);
      if (recent.length > 10) recent.shift();
    }

    console.log(`── ${P.label}  (n ${rows.length}, base ${(base * 100).toFixed(1)}%) ${"─".repeat(18)}`);
    reportSignal(rows, base);
    console.log("");
  }
  console.log("Spread + Brier improvement + a PA gap that's SMALL relative to the spread = a real signal worth wiring.");
  console.log(`(f=1 floor for an edgeless prop = ${((-0.06 / 1.06) * 100).toFixed(1)}%.)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
