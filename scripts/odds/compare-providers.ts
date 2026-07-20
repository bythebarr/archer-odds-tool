import "dotenv/config";

/**
 * Measure ParlayAPI against The Odds API on the SAME games, so a provider
 * decision rests on observed data rather than either vendor's marketing.
 *
 *   npx tsx scripts/odds/compare-providers.ts [sportKey]
 *
 * What it answers:
 *   • Do they see the same events?
 *   • How many books does each carry, and which does ONLY one of them have?
 *   • Is Pinnacle actually present? (the sharp baseline is the real prize)
 *   • Do their prices agree on the same game, at the same book?
 *   • Is the "drop-in compatible" claim true for the endpoints we depend on?
 *
 * Deliberately ONE call per provider per run — the evaluation key is a 1,000
 * credit free tier and burning it on a comparison would be self-defeating.
 */

const TOA_BASE = "https://api.the-odds-api.com/v4";
const PARLAY_BASE = "https://parlay-api.com/v1";
const SPORT = process.argv[2] ?? "baseball_mlb";

interface Outcome { name: string; price: number; point?: number }
interface Market { key: string; outcomes: Outcome[] }
interface Bookmaker { key: string; title: string; last_update?: string; markets: Market[] }
interface Event {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
}

async function pull(base: string, key: string, label: string): Promise<Event[]> {
  const url = new URL(`${base}/sports/${SPORT}/odds`);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("apiKey", key);
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`  ${label}: ✗ ${res.status} ${(await res.text()).slice(0, 200)}`);
    return [];
  }
  const used = res.headers.get("x-requests-used");
  const left = res.headers.get("x-requests-remaining");
  console.log(`  ${label}: ok · credits used ${used ?? "?"} · remaining ${left ?? "?"}`);
  return (await res.json()) as Event[];
}

/** h2h price for the home team, at a given book. */
function homePrice(ev: Event, bookKey: string): number | null {
  const book = ev.bookmakers.find((b) => b.key === bookKey);
  const h2h = book?.markets.find((m) => m.key === "h2h");
  return h2h?.outcomes.find((o) => o.name === ev.home_team)?.price ?? null;
}

function books(evs: Event[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of evs) for (const b of e.bookmakers) counts.set(b.key, (counts.get(b.key) ?? 0) + 1);
  return counts;
}

async function main() {
  const toaKey = process.env.ODDS_API_KEY;
  const parlayKey = process.env.PARLAY_API_KEY;
  if (!parlayKey) throw new Error("Set PARLAY_API_KEY in .env");

  console.log(`\nProvider comparison — ${SPORT}\n${"=".repeat(40)}\n`);

  const [toa, parlay] = await Promise.all([
    toaKey ? pull(TOA_BASE, toaKey, "the-odds-api") : Promise.resolve([]),
    pull(PARLAY_BASE, parlayKey, "parlay-api  "),
  ]);

  console.log(`\nEVENTS\n  the-odds-api: ${toa.length}\n  parlay-api:   ${parlay.length}`);

  const toaBooks = books(toa);
  const parlayBooks = books(parlay);
  console.log(`\nBOOKS\n  the-odds-api: ${toaBooks.size} distinct\n  parlay-api:   ${parlayBooks.size} distinct`);

  const onlyParlay = [...parlayBooks.keys()].filter((b) => !toaBooks.has(b)).sort();
  const onlyToa = [...toaBooks.keys()].filter((b) => !parlayBooks.has(b)).sort();
  if (onlyParlay.length) console.log(`\n  ONLY on parlay-api (${onlyParlay.length}): ${onlyParlay.join(", ")}`);
  if (onlyToa.length) console.log(`  ONLY on the-odds-api (${onlyToa.length}): ${onlyToa.join(", ")}`);

  // The sharp baseline is the whole reason to switch — check it explicitly.
  const sharp = ["pinnacle", "betonlineag", "bookmaker"];
  for (const s of sharp) {
    const inToa = toaBooks.has(s);
    const inParlay = parlayBooks.has(s);
    if (inToa || inParlay) {
      console.log(`  ${s}: ${inParlay ? "✅ parlay" : "— parlay"} / ${inToa ? "✅ toa" : "— toa"}`);
    }
  }

  // Do the two providers agree on the same game at the same book? A systematic
  // gap here would mean one of them is stale, which matters more than coverage.
  const byMatch = new Map(parlay.map((e) => [`${e.home_team}|${e.away_team}`, e]));
  const shared: Array<{ game: string; book: string; toa: number; parlay: number }> = [];
  for (const e of toa) {
    const p = byMatch.get(`${e.home_team}|${e.away_team}`);
    if (!p) continue;
    for (const bk of ["draftkings", "fanduel", "betmgm"]) {
      const a = homePrice(e, bk);
      const b = homePrice(p, bk);
      if (a !== null && b !== null) shared.push({ game: `${e.away_team} @ ${e.home_team}`, book: bk, toa: a, parlay: b });
    }
  }
  const disagreements = shared.filter((s) => s.toa !== s.parlay);
  console.log(
    `\nPRICE AGREEMENT (same game, same book, h2h home)\n  compared: ${shared.length} · identical: ${shared.length - disagreements.length} · differ: ${disagreements.length}`
  );
  for (const d of disagreements.slice(0, 8)) {
    console.log(`    ${d.book.padEnd(12)} ${d.game}: toa ${d.toa} vs parlay ${d.parlay}`);
  }

  // Endpoints we depend on that the docs don't obviously cover.
  console.log("\nENDPOINT COMPATIBILITY (the parts that aren't drop-in)");
  for (const [label, path] of [
    ["scores (tennis grading)", `/sports/${SPORT}/scores?daysFrom=1`],
    ["props", `/sports/${SPORT}/props`],
  ] as const) {
    const url = new URL(`${PARLAY_BASE}${path}`);
    url.searchParams.set("apiKey", parlayKey);
    try {
      const res = await fetch(url);
      const body = (await res.text()).slice(0, 120);
      console.log(`  ${label}: HTTP ${res.status}${res.ok ? "" : ` — ${body}`}`);
    } catch (err) {
      console.log(`  ${label}: request failed — ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log();
}

main().catch((err) => {
  console.error("\n✗", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
