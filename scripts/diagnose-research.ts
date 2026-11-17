import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { todayEt } from "@/lib/dateEt";
import { getLeagueDays } from "@/lib/queries/lobby";
import { getNbaPropsSlate, toWireSlate } from "@/lib/queries/nbaProps";
import { unpackLog, type GameLogPoint } from "@/lib/nba/propsMath";
import { nbaShadowRows, nbaValueBoard } from "@/lib/shadow/capture";
import { nbaQuoteAges } from "@/lib/shadow/quoteAges";
import { CANDIDATE_RULE, type SideValue } from "@/lib/shadow/marketValue";

/**
 * Read-only: tonight's plus-money research board (/nba/research) as the
 * screen would build it now — how many sides, how many at +100 to +175, how
 * many pass the data-quality gate, the warnings that stop the rest, which
 * books price the slate, and the frozen rule's candidates. Writes nothing.
 *
 * Run: `npm run diagnose:research`.
 */
const emit = (tag: string, o: unknown) => console.log(`@@${tag}@@${JSON.stringify(o)}`);
const r3 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);

async function main() {
  const days = await getLeagueDays("nba", todayEt());
  const date = days[0] ?? todayEt();
  const slate = toWireSlate(await getNbaPropsSlate(date));
  const logs = Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackLog)])) as Record<string, GameLogPoint[]>;
  const now = new Date();
  const upcoming = new Set(slate.games.filter((g) => new Date(g.startUtc) > now).map((g) => g.id));
  const ages = await nbaQuoteAges([...upcoming]);
  const rows = nbaShadowRows(slate, logs, upcoming);
  const board = nbaValueBoard(slate, rows, ages, now);
  const sides = board.values.flatMap((r) => [r.over, r.under].filter((s): s is SideValue => s !== null).map((s) => ({ r, s })));
  const plus = sides.filter(({ s }) => s.price >= CANDIDATE_RULE.minPrice && s.price <= CANDIDATE_RULE.maxPrice);
  const warnings: Record<string, number> = {};
  for (const { s } of plus) for (const w of s.warnings) warnings[w] = (warnings[w] ?? 0) + 1;
  const books: Record<string, number> = {};
  for (const p of slate.props) for (const q of p.quotes) books[q.bookName] = (books[q.bookName] ?? 0) + 1;
  emit("BOARD", {
    date,
    games: slate.games.length,
    upcomingGames: upcoming.size,
    props: board.values.length,
    v2Priced: rows.filter((r) => r.v2).length,
    sides: sides.length,
    plusMoney: plus.length,
    plusMoneyPassingQuality: plus.filter(({ s }) => s.quality).length,
    plusMoneyPositiveEv: plus.filter(({ s }) => s.quality && (s.ev ?? 0) > 0).length,
    warningsOnPlusMoney: warnings,
    quotesByBook: books,
    candidates: board.candidates.length,
  });
  for (const id of board.candidates) {
    const side = id.endsWith("|over") ? "over" : "under";
    const r = board.values.find((v) => `${v.id}|${side}` === id)!;
    const s = (side === "over" ? r.over : r.under)!;
    emit("CANDIDATE", { player: r.player, stat: r.stat, side, point: r.point, price: s.price, book: s.book, breakEven: r3(s.breakEven), noVig: r3(s.noVig), raw: r3(s.rawProb), s2: r3(s.s2Prob), v2: r3(s.v2Prob), ev: r3(s.ev), marketEv: r3(s.marketEv), distance: r3(s.distance), minutes: r3(r.minutes), reliability: s.minutesReliability, priceAge: s.priceAgeMinutes, warnings: s.warnings, status: s.status });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
