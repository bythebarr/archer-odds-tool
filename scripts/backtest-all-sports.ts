/**
 * Walk-forward check of the all-sports models on every league with history:
 * each game is predicted from the games before it, scored by log loss against
 * the league's own base rates (home / draw / away shares, also learned only
 * from earlier games). Prints one row per league; a negative "vs base" means
 * the model beats simply knowing how often home teams win.
 *
 *   npm run backtest:all-sports
 */
import { prisma } from "@/lib/prisma";
import { allSportOrDefault } from "@/lib/allSports/sports";
import { rateLeague, type Result } from "@/lib/allSports/model/ratings";
import { lineOutcomeFor } from "@/lib/allSports/model/outcomes";

const MIN_GAMES = 5;
const EVERY = Number(process.env.STEP ?? 1); // rebuild ratings every N games (speed)

async function main() {
  const leagues = await prisma.league.findMany({ where: { outright: false } });
  console.log("league                               games  model LL  base LL  vs base  hit%");
  for (const l of leagues) {
    const fam = allSportOrDefault(l.sport).family;
    const rows = await prisma.sportEvent.findMany({ where: { leagueId: l.id, status: "final", homeScore: { not: null } }, orderBy: { startsAt: "asc" } });
    const results: Result[] = rows.map((r) => ({ date: r.startsAt, home: r.home, away: r.away, homeScore: r.homeScore!, awayScore: r.awayScore! }));
    if (results.length < 150) continue;
    let ll = 0, base = 0, hits = 0, n = 0;
    const counts = { home: 1, draw: fam === "goals" ? 1 : 0, away: 1 };
    let ratings = rateLeague(fam, l.sport, []);
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (i % EVERY === 0) ratings = rateLeague(fam, l.sport, results.slice(0, i));
      const outcome = r.homeScore > r.awayScore ? "home" : r.homeScore < r.awayScore ? "away" : "draw";
      const tot = counts.home + counts.draw + counts.away;
      if (ratings.games(r.home) >= MIN_GAMES && ratings.games(r.away) >= MIN_GAMES && (outcome !== "draw" || fam === "goals")) {
        const threeWay = l.sport === "soccer";
        const p = (side: string) => lineOutcomeFor(ratings, r.home, r.away, { kind: "ml", period: "game", side, team: "", point: 0, threeWay }, l.sport)?.win ?? null;
        let probs: Record<string, number>;
        if (threeWay) probs = { home: p("home")!, draw: p("draw")!, away: p("away")! };
        else {
          // 2-way: a draw (hockey shootout aside) is settled in overtime; score the winner.
          const h = p("home")!;
          probs = { home: h, away: 1 - h, draw: 0 };
        }
        const b = threeWay ? { home: counts.home / tot, draw: counts.draw / tot, away: counts.away / tot } : { home: counts.home / (counts.home + counts.away), away: counts.away / (counts.home + counts.away), draw: 0 };
        const actual = outcome === "draw" && !threeWay ? null : outcome;
        if (actual) {
          ll += -Math.log(Math.max(1e-6, probs[actual]!));
          base += -Math.log(Math.max(1e-6, b[actual as keyof typeof b]));
          const pick = Object.entries(probs).sort((x, y) => y[1] - x[1])[0]![0];
          hits += pick === actual ? 1 : 0;
          n++;
        }
      }
      counts[outcome]++;
    }
    if (n === 0) continue;
    console.log(`${l.id.padEnd(36)} ${String(n).padStart(5)}  ${(ll / n).toFixed(4)}   ${(base / n).toFixed(4)}  ${((ll - base) / n >= 0 ? "+" : "") + ((ll - base) / n).toFixed(4)}  ${((hits / n) * 100).toFixed(1)}`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
