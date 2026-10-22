/**
 * Lists the NBA prop market keys the odds provider is serving right now, with
 * row counts and whether we map each one — the check to run when a market seems
 * missing from /nba/props. Costs one bulk props call (~3 credits).
 *
 *   npx tsx scripts/nba/probe-prop-markets.ts
 */
import "dotenv/config";
import { fetchBulkPlayerProps } from "@/lib/odds/oddsApiClient";
import { NBA_MARKET_KEY_TO_STAT, nbaAltMarketStat } from "@/lib/nba/propStats";

async function main() {
  const { rows, creditsUsed } = await fetchBulkPlayerProps("basketball_nba");
  const counts = new Map<string, { rows: number; books: Set<string>; sample: string }>();
  for (const row of rows) {
    const entry = counts.get(row.market_key) ?? { rows: 0, books: new Set(), sample: `${row.player} ${row.line}` };
    entry.rows++;
    entry.books.add(row.bookmaker);
    counts.set(row.market_key, entry);
  }
  console.log(`${rows.length} rows, ${counts.size} market keys, ${creditsUsed ?? "?"} credits\n`);
  for (const [key, { rows: n, books, sample }] of [...counts].sort((a, b) => b[1].rows - a[1].rows)) {
    const mapped = NBA_MARKET_KEY_TO_STAT[key] ?? nbaAltMarketStat(key);
    console.log(`${mapped ? "✓" : "·"} ${key.padEnd(40)} ${String(n).padStart(5)} rows  ${books.size} books  e.g. ${sample}${mapped ? `  → ${mapped}` : ""}`);
  }
}

main();
