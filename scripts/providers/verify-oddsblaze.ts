/**
 * Live check of the OddsBlaze provider module against a real slate.
 *
 *   npx tsx --env-file=.env scripts/providers/verify-oddsblaze.ts [league]
 *
 * Proves the fan-out + normalizer produce exactly the OddsApiEvent shape
 * storeBookmakerOdds consumes: nested book→market→outcome, our canonical book
 * keys, our market keys (h2h/spreads/totals), Over/Under sides, numeric prices,
 * and the MLB gamePk carried through. Makes no DB writes.
 */
import { fetchOddsBlazeGameOdds } from "@/lib/odds/providers/oddsblaze";
import { oddsProviderForSport, oddsBlazeLeaguesForSport } from "@/lib/odds/providers/registry";

const args = process.argv.slice(2);
const includeLive = args.includes("--live");
const league = args.find((a) => !a.startsWith("--")) ?? "mlb";

async function main() {
  console.log(`registry: mlb → ${oddsProviderForSport("mlb")} | oddsblaze mlb leagues → ${oddsBlazeLeaguesForSport("mlb").join(",")}\n`);

  const { events, creditsUsed } = await fetchOddsBlazeGameOdds(league, { skipLive: !includeLive });
  console.log(`normalized ${events.length} pre-match events (cost ~${creditsUsed} requests)\n`);

  // richest game first, so we see multi-book merge + all three markets
  const game = [...events].sort((a, b) => b.bookmakers.length - a.bookmakers.length)[0];
  if (!game) {
    console.log("no pre-match events right now.");
    return;
  }

  console.log(`${game.away_team} @ ${game.home_team}`);
  console.log(`  id: ${game.id} | mlbGameId: ${game.mlbGameId ?? "—"} | books: ${game.bookmakers.length}`);
  const marketKeys = new Set(game.bookmakers.flatMap((b) => b.markets.map((m) => m.key)));
  console.log(`  market keys present: ${[...marketKeys].join(", ")}`);
  console.log(`  book keys (canonical): ${game.bookmakers.map((b) => b.key).join(", ")}`);
  // rung counts on the first book, to prove the alt ladder came through
  const b0 = game.bookmakers[0];
  const rungs = b0.markets.map((m) => `${m.key}:${m.outcomes.length}`).join(" ");
  console.log(`  ${b0.key} rung counts → ${rungs}\n`);

  // dump one book fully to eyeball outcome shape
  const sample = game.bookmakers[0];
  console.log(`  sample book "${sample.key}":`);
  for (const m of sample.markets) {
    for (const o of m.outcomes) {
      const pt = o.point != null ? ` @ ${o.point}` : "";
      console.log(`    ${m.key.padEnd(8)} ${o.name}${pt}  ${(o.price ?? 0) > 0 ? "+" : ""}${o.price}`);
    }
  }

  // moneyline shop across books, to confirm the merge really is multi-book
  console.log(`\n  moneyline across books:`);
  for (const b of game.bookmakers) {
    const ml = b.markets.find((m) => m.key === "h2h");
    if (!ml) continue;
    const away = ml.outcomes.find((o) => o.name === game.away_team)?.price;
    const home = ml.outcomes.find((o) => o.name === game.home_team)?.price;
    const f = (p?: number | null) => (p == null ? "—" : `${p > 0 ? "+" : ""}${p}`);
    console.log(`    ${b.key.padEnd(12)} ${f(away)} / ${f(home)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
