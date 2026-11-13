import "dotenv/config";
import { prisma } from "@/lib/prisma";
import {
  LAG_WINDOW_MIN,
  PIN_MAX_AGE_MIN,
  MIN_VERDICT,
  MOVE_PROB,
  SHARP_BOOK,
  SOFT_BOOKS,
  bucketStats,
  clvOf,
  findLagBets,
  lagSize,
  settle,
  verdict,
  type BucketStats,
  type Market,
  type Quote,
  type SettledBet,
  type SideKey,
} from "@/lib/audit/softBookLag";

/**
 * Soft-book lag vs Pinnacle (lib/audit/softBookLag): when Pinnacle moves and a
 * retail book hasn't caught up, does betting the stale retail price win?
 *
 * Read-only, from stored OddsSnapshot history: main lines only (no alt
 * rungs), polls before each game's start, games with a final score. Bets
 * settle from the final score at the bet's own number. GameOutcome grades
 * spreads and totals only at the consensus closing number, so it serves as
 * a cross-check where the numbers match. Closing-line value is read against
 * GameClosingLine at the same number.
 *
 * Pinnacle and the retail books are polled on different schedules, so each
 * soft quote is judged against Pinnacle's latest quote before it. If the
 * snapshots can't establish lag (too few Pinnacle rows, no per-book update
 * times, no soft quote with a recent Pinnacle quote before it, no settled
 * games), prints DATA REQUIRED with what's missing and exits non-zero.
 * Run from the Model lab (script: backtest:soft-book-lag).
 */
const BOOKS = [SHARP_BOOK, ...SOFT_BOOKS];
const MARKETS: Market[] = ["h2h", "spreads", "totals"];
/** Fewer Pinnacle quotes than this in the window can't establish its moves. */
const MIN_PIN_ROWS = 500;
const pct = (x: number) => (Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
const rate = (x: number) => (Number.isNaN(x) ? "—" : `${(x * 100).toFixed(1)}%`);
const line = (s: BucketStats) =>
  `  ${s.label.padEnd(26).slice(0, 26)} n=${String(s.n).padStart(5)} · hit ${rate(s.hitRate).padStart(6)} · ROI ${pct(s.roi).padStart(7)} [${pct(s.roiLow)}, ${pct(s.roiHigh)}]${s.clvN ? ` · CLV ${s.clv! >= 0 ? "+" : ""}${(s.clv! * 100).toFixed(2)} pts (${s.clvN})` : " · CLV —"}${s.thin ? "  (thin)" : ""}`;

function dataRequired(missing: string[]) {
  console.log(`\nVERDICT: DATA REQUIRED — ${missing.join("; ")}`);
  process.exitCode = 1;
}

async function main() {
  const games = await prisma.game.findMany({
    where: { homeScore: { not: null }, awayScore: { not: null }, scheduledStartUtc: { lte: new Date(), gte: new Date(Date.now() - 120 * 86_400_000) } }, // snapshots are pruned past 90 days
    select: { id: true, sport: true, scheduledStartUtc: true, homeTeamId: true, homeScore: true, awayScore: true },
  });
  console.log(`Games with a final score: ${games.length}`);

  const quotesByGame = new Map<string, Map<Market, Quote[]>>();
  let pinRows = 0;
  let softRows = 0;
  let pinSameStamp = 0;
  let softSameStamp = 0;
  let minPolled = Infinity;
  let maxPolled = -Infinity;
  for (let i = 0; i < games.length; i += 200) {
    const batch = games.slice(i, i + 200);
    const start = new Map(batch.map((g) => [g.id, g.scheduledStartUtc.getTime()]));
    const rows = await prisma.oddsSnapshot.findMany({
      where: { gameId: { in: batch.map((g) => g.id) }, bookKey: { in: BOOKS }, isAlternate: false, side: { not: "draw" } },
      select: { gameId: true, bookKey: true, marketType: true, side: true, point: true, priceAmerican: true, polledAt: true, sourceLastUpdate: true },
    });
    for (const r of rows) {
      if (r.polledAt.getTime() >= start.get(r.gameId)!) continue; // pre-game only
      const same = Math.abs(r.sourceLastUpdate.getTime() - r.polledAt.getTime()) < 1000;
      if (r.bookKey === SHARP_BOOK) {
        pinRows++;
        if (same) pinSameStamp++;
      } else {
        softRows++;
        if (same) softSameStamp++;
      }
      minPolled = Math.min(minPolled, r.polledAt.getTime());
      maxPolled = Math.max(maxPolled, r.polledAt.getTime());
      const m = r.marketType as Market;
      const byMarket = quotesByGame.get(r.gameId) ?? quotesByGame.set(r.gameId, new Map()).get(r.gameId)!;
      (byMarket.get(m) ?? byMarket.set(m, []).get(m)!).push({ book: r.bookKey, side: r.side as SideKey, point: r.point, price: r.priceAmerican, polledAt: r.polledAt, sourceLastUpdate: r.sourceLastUpdate });
    }
  }

  const window = Number.isFinite(minPolled) ? `${new Date(minPolled).toISOString().slice(0, 16)}Z → ${new Date(maxPolled).toISOString().slice(0, 16)}Z` : "no snapshots";
  console.log(`Snapshot window (pre-game, main lines, settled games): ${window}`);
  console.log(`Rows: Pinnacle ${pinRows} · soft books ${softRows} (${SOFT_BOOKS.join(", ")})`);
  console.log(`Rows whose book update time equals the poll time (no per-book timestamp; soft rows like this are judged by an unchanged quote instead): Pinnacle ${pinSameStamp}/${pinRows} · soft ${softSameStamp}/${softRows}`);

  // Overlap: soft quotes with a two-sided Pinnacle quote on the same game and market at or before them, within PIN_MAX_AGE_MIN.
  let overlap = 0;
  for (const byMarket of quotesByGame.values())
    for (const [market, quotes] of byMarket) {
      const [sa, sb] = market === "totals" ? ["over", "under"] : ["home", "away"];
      const pinPolls = [...new Set(quotes.filter((q) => q.book === SHARP_BOOK).map((q) => q.polledAt.getTime()))]
        .filter((t) => quotes.some((q) => q.book === SHARP_BOOK && q.side === sa && q.polledAt.getTime() === t) && quotes.some((q) => q.book === SHARP_BOOK && q.side === sb && q.polledAt.getTime() === t))
        .sort((x, y) => x - y);
      if (!pinPolls.length) continue;
      for (const q of quotes) {
        if (q.book === SHARP_BOOK) continue;
        const t = q.polledAt.getTime();
        const latest = pinPolls.filter((p) => p <= t).at(-1);
        if (latest !== undefined && t - latest <= PIN_MAX_AGE_MIN * 60_000) overlap++;
      }
    }
  console.log(`Soft quotes with a two-sided Pinnacle quote on the same game and market at most ${PIN_MAX_AGE_MIN / 60} h before them: ${overlap}`);

  const missing: string[] = [];
  if (games.length === 0) missing.push("no games with a final score");
  if (pinRows < MIN_PIN_ROWS) missing.push(`only ${pinRows} pre-game Pinnacle main-line quotes in the window (needs ${MIN_PIN_ROWS}+)`);
  if (pinRows > 0 && pinSameStamp / pinRows > 0.99) missing.push("Pinnacle rows carry no update time of their own (sourceLastUpdate equals polledAt), so its moves can't be timed");
  if (softRows === 0) missing.push("no soft-book quotes in the window");
  if (overlap === 0) missing.push(`no soft-book quote has a two-sided Pinnacle quote on the same game and market within ${PIN_MAX_AGE_MIN / 60} h before it`);
  if (missing.length) return dataRequired(missing);

  const closes = await prisma.gameClosingLine.findMany({ where: { gameId: { in: [...quotesByGame.keys()] } }, select: { gameId: true, marketType: true, side: true, point: true, priceAmerican: true } });
  const closeOf = new Map(closes.map((c) => [`${c.gameId}|${c.marketType}|${c.side}`, c]));
  const outcomes = await prisma.gameOutcome.findMany({ where: { gameId: { in: [...quotesByGame.keys()] }, teamId: { not: null } }, select: { gameId: true, teamId: true, marketType: true, result: true } });
  const outcomeOf = new Map(outcomes.map((o) => [`${o.gameId}|${o.teamId}|${o.marketType}`, o.result]));
  const gameById = new Map(games.map((g) => [g.id, g]));

  const bets: SettledBet[] = [];
  let crossChecked = 0;
  let crossAgree = 0;
  for (const [gameId, byMarket] of quotesByGame) {
    const g = gameById.get(gameId)!;
    for (const market of MARKETS) {
      const quotes = byMarket.get(market);
      if (!quotes) continue;
      if (market === "h2h" && g.sport === "soccer") continue; // three-way (draw): a two-way no-vig price doesn't apply
      for (const b of findLagBets(market, quotes)) {
        const result = settle(market, b.side, b.point, g.homeScore!, g.awayScore!);
        const close = closeOf.get(`${gameId}|${market}|${b.side}`);
        const clv = close && close.point === b.point ? clvOf(b.price, close.priceAmerican) : null;
        // Cross-check against GameOutcome where it grades the same bet: home moneyline, home spread or over at the closing number.
        if (g.homeTeamId && (b.side === "home" || b.side === "over") && (market === "h2h" || (close && close.point === b.point))) {
          const o = outcomeOf.get(`${gameId}|${g.homeTeamId}|${market}`);
          if (o) {
            crossChecked++;
            if (o === result) crossAgree++;
          }
        }
        bets.push({ ...b, sport: g.sport, market, result, clv });
      }
    }
  }

  console.log(`\nMethod: Pinnacle moves toward a side when its no-vig chance rises ≥ ${(MOVE_PROB * 100).toFixed(1)} pts at the same number (≈5 cents at −110), or the number moves against the side.`);
  console.log(`Each soft quote is judged against Pinnacle's latest quote at or before it (at most ${PIN_MAX_AGE_MIN / 60} h old, older no longer says where the sharp market is). It is stale when the poll is ≥ ${LAG_WINDOW_MIN} min after Pinnacle's move and its own update time is before the move, or (rows with no update time of their own) the same quote was already on the board before the move, unchanged since; it must still beat Pinnacle's new terms. One bet per game × market × side × book, 1 unit at the stale price.`);
  console.log(`Soccer moneylines are left out (three-way with the draw). Settled from final scores at the bet's own number; GameOutcome cross-check where it grades the same bet: ${crossAgree}/${crossChecked} agree.`);

  if (!bets.length) return dataRequired(["no lag bets fired in the window: Pinnacle never moved while a soft book stayed stale on the snapshots stored"]);

  const by = (label: string, key: (b: SettledBet) => string) => {
    console.log(`\n── By ${label}`);
    const groups = new Map<string, SettledBet[]>();
    for (const b of bets) (groups.get(key(b)) ?? groups.set(key(b), []).get(key(b))!).push(b);
    for (const [k, rows] of [...groups].sort((a, b) => b[1].length - a[1].length)) console.log(line(bucketStats(k, rows)));
  };
  const all = bucketStats("ALL lag bets", bets);
  console.log(`\nBuckets under ${MIN_VERDICT} bets are thin: printed, not verdicts. ROI is flat 1-unit stakes; the interval is 95%. CLV: implied chance at the close minus at the bet, same number only.`);
  console.log(line(all));
  by("lag size", lagSize);
  by("minutes since Pinnacle moved", (b) => (b.lagMin < 30 ? "10–29 min" : b.lagMin < 120 ? "30–119 min" : b.lagMin < 360 ? "2–6 h" : "6 h+"));
  by("how staleness was established", (b) => b.staleBy);
  by("book", (b) => b.book);
  by("market", (b) => b.market);
  by("sport", (b) => b.sport);
  console.log(`\nVERDICT: ${verdict(all)}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
