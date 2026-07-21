import "dotenv/config";
import { BETTABLE_BOOK_KEYS } from "@/lib/odds/bookAllowlist";

/**
 * What can the odds provider actually carry, per sport?
 *
 * Written after the ParlayAPI switch was verified on MLB and then assumed to
 * generalise — it doesn't (tennis has 4 books and no props at all). Rather than
 * re-litigate that from memory, this prints the table in
 * docs/architecture/provider-coverage.md. Re-run it before adding a sport, or
 * when deciding whether a sport can hold a paid surface.
 *
 *   npx tsx scripts/odds/audit-coverage.ts
 *
 * Costs a handful of credits (3 calls x 7 sports, mostly 1-3 credits each).
 */

const BASE = "https://api.parlay-api.com/v1";
const BETTABLE = new Set<string>(BETTABLE_BOOK_KEYS);

/** The sports this app uses, plus the majors that are the obvious next adapters. */
const SPORTS: Array<[string, string]> = [
  ["MLB", "baseball_mlb"],
  ["NFL", "americanfootball_nfl"],
  ["NBA", "basketball_nba"],
  ["UFC/MMA", "mma_mixed_martial_arts"],
  ["Tennis ATP", "tennis_atp"],
  ["Tennis WTA", "tennis_wta"],
  ["Soccer WC", "soccer_fifa_world_cup"],
];

interface AnyEvent {
  id?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: Array<{ key?: string }>;
}
interface AnyPropRow {
  bookmaker?: string;
  market_key?: string;
}

async function get<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("apiKey", process.env.PARLAY_API_KEY ?? "");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Do /odds and /scores agree on ids for events BOTH list? Parlay's ids are not
 * stable across endpoints, and the failure is partial rather than total, which
 * is exactly what makes it dangerous — see the doc.
 */
function idAgreement(odds: AnyEvent[], scores: AnyEvent[]): string {
  const key = (e: AnyEvent) => `${e.away_team}@${e.home_team}`;
  const byMatchup = (list: AnyEvent[]) => {
    const m = new Map<string, string>();
    for (const e of list) if (e.id && !m.has(key(e))) m.set(key(e), e.id);
    return m;
  };
  const o = byMatchup(odds);
  const s = byMatchup(scores);
  const shared = [...o.keys()].filter((k) => s.has(k));
  if (!shared.length) return "n/a";
  const agree = shared.filter((k) => o.get(k) === s.get(k)).length;
  return `${agree}/${shared.length}`;
}

async function main() {
  if (!process.env.PARLAY_API_KEY) throw new Error("PARLAY_API_KEY is not set");

  const rows: string[][] = [];
  for (const [label, key] of SPORTS) {
    const odds =
      (await get<AnyEvent[]>(`/sports/${key}/odds`, {
        markets: "h2h",
        oddsFormat: "american",
        include_live: "true",
      })) ?? [];
    const scores = (await get<AnyEvent[]>(`/sports/${key}/scores`, { daysFrom: "3", dateFormat: "iso" })) ?? [];
    const props = (await get<AnyPropRow[]>(`/sports/${key}/props`, { limit: "10000" })) ?? [];

    const books = new Set<string>();
    for (const e of odds) for (const b of e.bookmakers ?? []) if (b.key) books.add(b.key);
    const propBooks = new Set(props.map((r) => r.bookmaker).filter(Boolean) as string[]);
    const propMarkets = new Set(props.map((r) => r.market_key).filter(Boolean) as string[]);

    const bettable = [...books].filter((b) => BETTABLE.has(b)).length;
    rows.push([
      label,
      String(odds.length),
      String(bettable),
      books.has("pinnacle") ? "yes" : "-",
      String(scores.length),
      String(props.length),
      String([...propBooks].filter((b) => BETTABLE.has(b)).length),
      String(propMarkets.size),
      idAgreement(odds, scores),
    ]);
  }

  const head = ["SPORT", "odds", "books", "pinn", "scores", "props", "pbk", "pmkt", "odds=scores"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(head));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
  console.log("\nSee docs/architecture/provider-coverage.md for what these numbers mean.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
