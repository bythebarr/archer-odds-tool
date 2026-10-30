/**
 * EventPropLine rows for one event, grouped the way a props board reads:
 * per player, per stat and period — the main Over/Under line(s), the alt
 * ladder, and Yes props — each book's price beside each number. Pure.
 */
export interface BoardRow {
  athleteId: string;
  athleteName: string | null;
  market: string;
  statKey: string;
  period: string;
  side: string;
  point: number;
  bookKey: string;
  priceAmerican: number | null;
}

export interface BoardPrice {
  bookKey: string;
  priceAmerican: number | null;
}

export interface BoardMarket {
  /** A readable title from the book's own market name: "Total Points" → "Points". */
  title: string;
  period: string;
  /** Main lines: Over and Under at the same number. */
  lines: { point: number; over: BoardPrice[]; under: BoardPrice[] }[];
  /** Alt ladder rungs (Over only, N+ = over N − 0.5). */
  ladder: { point: number; prices: BoardPrice[] }[];
  /** Yes-only props. */
  yes: BoardPrice[];
}

export interface BoardPlayer {
  athleteId: string;
  name: string;
  markets: BoardMarket[];
}

const PERIOD_ORDER = ["game", "h1", "h2", "q1", "q2", "q3", "q4", "p1", "p2", "p3"];

export function titleOf(market: string): string {
  return market
    .replace(/\s*\(incl\. overtime\)\s*/i, " ")
    .replace(/\s+milestones$/i, "")
    .replace(/^total\s+/i, "")
    .trim();
}

export function groupPropBoard(rows: BoardRow[]): BoardPlayer[] {
  const players = new Map<string, { name: string; markets: Map<string, BoardMarket & { order: number }> }>();
  for (const r of rows) {
    const p = players.get(r.athleteId) ?? { name: r.athleteName ?? `#${r.athleteId}`, markets: new Map() };
    players.set(r.athleteId, p);
    // Main line, ladder and Yes for one stat share a market card.
    const key = `${r.statKey}|${r.period}`;
    const m: BoardMarket & { order: number } = p.markets.get(key) ?? { title: titleOf(r.market), period: r.period, lines: [], ladder: [], yes: [], order: PERIOD_ORDER.indexOf(r.period) };
    p.markets.set(key, m);
    const price = { bookKey: r.bookKey, priceAmerican: r.priceAmerican };
    if (r.side === "yes") m.yes.push(price);
    else if (/milestones$/i.test(r.market)) {
      const rung = m.ladder.find((x) => x.point === r.point) ?? m.ladder[m.ladder.push({ point: r.point, prices: [] }) - 1];
      rung.prices.push(price);
    } else {
      const line = m.lines.find((x) => x.point === r.point) ?? m.lines[m.lines.push({ point: r.point, over: [], under: [] }) - 1];
      (r.side === "under" ? line.under : line.over).push(price);
    }
  }
  return [...players.entries()]
    .map(([athleteId, p]) => ({
      athleteId,
      name: p.name,
      markets: [...p.markets.values()]
        .sort((a, b) => (a.order < 0 ? 99 : a.order) - (b.order < 0 ? 99 : b.order) || a.title.localeCompare(b.title))
        .map(({ order: _order, ...m }) => ({ ...m, lines: m.lines.sort((a, b) => a.point - b.point), ladder: m.ladder.sort((a, b) => a.point - b.point) })),
    }))
    .sort((a, b) => b.markets.length - a.markets.length || a.name.localeCompare(b.name));
}
