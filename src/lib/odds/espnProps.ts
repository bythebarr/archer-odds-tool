/**
 * Player props from ESPN's free odds feed (the core API's `propBets` under an
 * event's odds provider — DraftKings today): every main line, every alt-line
 * rung and every yes-only prop, for any sport ESPN carries them in. Pure.
 *
 * How the feed lays them out (checked against DraftKings' own ladder):
 *   • "Total Points" — a pair per player per line, Over first then Under
 *     (over 21.5 at −106 matched the "22+" rung at −107 for every player).
 *   • "Points Milestones" — one Over price per rung, "22+" meaning over 21.5.
 *   • "To Record a Double Double", "First Basket" — a single Yes price.
 *   • A " - 1st Quarter" suffix scopes any of them to a period.
 * Props with no athlete are team or game markets; game lines come from the
 * scoreboard instead, so they're left out here.
 */
import { parseAmerican } from "./espnOdds";

export interface EspnPropBet {
  athlete?: { $ref?: string };
  type?: { id?: string; name?: string };
  odds?: { american?: { value?: string | number; open?: string | number }; total?: { value?: string | number } };
  current?: { target?: { value?: number; displayValue?: string } };
  lastUpdated?: string;
}

export type PropSide = "over" | "under" | "yes";

export interface EspnPropQuote {
  athleteId: string;
  /** The book's market, period suffix removed ("Total Points", "Points Milestones"). */
  market: string;
  /** "game" | "q1"…"q4" | "h1" | "h2" | "p1"… */
  period: string;
  /** The stat words, e.g. "points", "assists+points+rebounds", "double double". */
  statKey: string;
  side: PropSide;
  /** The number to beat (an "N+" rung is over N − 0.5); 0 for a yes-only prop. */
  point: number;
  /** Null when the book shows the number but no price yet (NFL props midweek). */
  priceAmerican: number | null;
  openPriceAmerican: number | null;
  updatedAt: Date | null;
}

export interface ParsedEspnProps {
  quotes: EspnPropQuote[];
  /** Team/game markets, and over/under lines whose pair didn't come through whole. */
  /** strayRungs: alt rungs dropped because they contradict the player's ladder (see oneLadder). */
  skipped: { noAthlete: number; unpaired: number; strayRungs: number };
  /** Quotes kept with a number but no price yet. */
  unpriced: number;
}

/** ".../athletes/6583?lang=en" → "6583". */
export function athleteIdOf(ref: string | undefined): string | null {
  const m = ref?.match(/\/athletes\/(\d+)/);
  return m ? m[1] : null;
}

const PERIODS: Record<string, string> = {
  "1st quarter": "q1",
  "2nd quarter": "q2",
  "3rd quarter": "q3",
  "4th quarter": "q4",
  "1st half": "h1",
  "2nd half": "h2",
  "1st period": "p1",
  "2nd period": "p2",
  "3rd period": "p3",
  "1st inning": "i1",
  "first 5 innings": "f5",
};

/**
 * The period a market is scoped to, written either way round:
 * "Points Milestones - 1st Quarter" or "1st Half Total Receiving Yards".
 * Any other " - " suffix ("Shots on Target - Header") stays part of the market.
 */
export function splitPeriod(name: string): { market: string; period: string } {
  const trimmed = name.trim();
  const suffix = trimmed.match(/^(.*?)\s+-\s+(.+)$/);
  const sp = suffix ? PERIODS[suffix[2].trim().toLowerCase()] : undefined;
  if (suffix && sp) return { market: suffix[1].trim(), period: sp };
  for (const [words, period] of Object.entries(PERIODS)) {
    if (trimmed.toLowerCase().startsWith(`${words} `)) return { market: trimmed.slice(words.length + 1).trim(), period };
  }
  return { market: trimmed, period: "game" };
}

/**
 * The stat a market is about, as sorted lower-case words joined by "+", so
 * "Total Points, Rebounds, and Assists" and "Points + Assists + Rebounds
 * Milestones" both read "assists+points+rebounds".
 */
export function statKeyOf(market: string): string {
  const core = market
    .replace(/\s*\(incl\. overtime\)\s*/i, " ")
    .trim()
    .replace(/\s+milestones$/i, "")
    .replace(/^total\s+/i, "")
    .toLowerCase();
  return core
    .split(/\s*(?:,|\+|\band\b|\bplus\b)\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join("+");
}

const isLadder = (market: string) => /\smilestones$/i.test(market);

/** "22+" / 22 → 21.5. */
function rungPoint(p: EspnPropBet): number | null {
  const v = p.current?.target?.value ?? Number(String(p.odds?.total?.value ?? "").replace(/\+$/, ""));
  return Number.isFinite(v) ? v - 0.5 : null;
}

function linePoint(p: EspnPropBet): number | null {
  const v = p.current?.target?.value ?? Number(p.odds?.total?.value);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const impliedOf = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));

/**
 * DraftKings' feed sometimes files a second, unlabeled ladder (a quarter's,
 * by its prices) under the full-game "Rebounds Milestones": a 2+ at +141
 * beside the real 3+ at −529, or the same rung twice. One real ladder gets
 * longer-priced as the number climbs, so this keeps the longest run of rungs
 * that does, one price per rung, and drops the rest. Unpriced ladders (NFL
 * midweek) can't be judged and pass through.
 */
export function oneLadder<T extends { p: EspnPropBet; point: number }>(rungs: T[]): T[] {
  const priced = rungs.map((r) => ({ r, price: parseAmerican(r.p.odds?.american?.value) }));
  if (priced.some((x) => x.price === null)) return rungs;
  const xs = priced.map((x) => ({ r: x.r, prob: impliedOf(x.price as number) })).sort((a, b) => a.r.point - b.r.point || b.prob - a.prob);
  // Longest chain with the number rising and the chance falling.
  const len = xs.map(() => 1);
  const prev = xs.map(() => -1);
  for (let i = 0; i < xs.length; i++)
    for (let j = 0; j < i; j++)
      if (xs[j].r.point < xs[i].r.point && xs[j].prob > xs[i].prob && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
  let end = 0;
  for (let i = 1; i < xs.length; i++) if (len[i] > len[end]) end = i;
  const out: T[] = [];
  for (let i = xs.length ? end : -1; i >= 0; i = prev[i]) out.unshift(xs[i].r);
  return out;
}

export function parseEspnProps(items: EspnPropBet[]): ParsedEspnProps {
  const out: ParsedEspnProps = { quotes: [], skipped: { noAthlete: 0, unpaired: 0, strayRungs: 0 }, unpriced: 0 };
  // Keep the feed's order within each (player, market, line): it's what tells Over from Under.
  const groups = new Map<string, { athleteId: string; name: string; point: number | null; items: EspnPropBet[] }>();
  for (const p of items) {
    const athleteId = athleteIdOf(p.athlete?.$ref);
    const name = p.type?.name?.trim();
    if (!athleteId || !name) {
      out.skipped.noAthlete++;
      continue;
    }
    const ladder = isLadder(splitPeriod(name).market);
    const point = ladder ? rungPoint(p) : linePoint(p);
    // A ladder is judged whole (oneLadder), a main line one number at a time.
    const key = `${athleteId}|${name}|${ladder ? "ladder" : point}`;
    const g = groups.get(key) ?? { athleteId, name, point, items: [] };
    g.items.push(p);
    groups.set(key, g);
  }

  for (const g of groups.values()) {
    const { market, period } = splitPeriod(g.name);
    const base = { athleteId: g.athleteId, market, period, statKey: statKeyOf(market) };
    const quote = (p: EspnPropBet, side: PropSide, point: number) => {
      const price = parseAmerican(p.odds?.american?.value);
      if (price === null) out.unpriced++;
      out.quotes.push({
        ...base,
        side,
        point,
        priceAmerican: price,
        openPriceAmerican: parseAmerican(p.odds?.american?.open),
        updatedAt: p.lastUpdated ? new Date(p.lastUpdated) : null,
      });
    };

    if (isLadder(market)) {
      const rungs = g.items.map((p) => ({ p, point: rungPoint(p) }));
      const placed = rungs.filter((r): r is { p: EspnPropBet; point: number } => r.point !== null);
      out.skipped.unpaired += rungs.length - placed.length;
      const kept = oneLadder(placed);
      out.skipped.strayRungs += placed.length - kept.length;
      for (const r of kept) quote(r.p, "over", r.point);
    } else if (g.point === null) {
      for (const p of g.items) quote(p, "yes", 0);
    } else if (g.items.length === 2) {
      quote(g.items[0], "over", g.point);
      quote(g.items[1], "under", g.point);
    } else {
      // A lone side, or more than a pair: we can't tell which is which.
      out.skipped.unpaired += g.items.length;
    }
  }
  return out;
}

/** NBA stat keys (statKeyOf) → NbaPropStat. */
export const NBA_STAT_BY_KEY: Record<string, string> = {
  points: "points",
  rebounds: "rebounds",
  assists: "assists",
  "3-point field goals": "threes",
  "3-pointers made": "threes",
  steals: "steals",
  blocks: "blocks",
  turnovers: "turnovers",
  "assists+points+rebounds": "pointsReboundsAssists",
  "points+rebounds": "pointsRebounds",
  "assists+points": "pointsAssists",
  "assists+rebounds": "reboundsAssists",
  "blocks+steals": "blocksSteals",
  "to record a double double": "doubleDouble",
  "to record a triple double": "tripleDouble",
};

/**
 * NFL stat keys → NflPropStat, from DraftKings' names in the feed ("Total
 * Receiving Yards (incl. overtime)", "Passing Touchdown Milestones", "Total
 * Carries"). A market with no typed stat (passing + rushing yards, first TD
 * scorer) is still stored in EventPropLine and counted as unmapped by the poll.
 */
export const NFL_STAT_BY_KEY: Record<string, string> = {
  "passing yards": "passYards",
  "passing touchdowns": "passTds",
  "passing touchdown": "passTds",
  "pass completions": "passCompletions",
  "passing completions": "passCompletions",
  "pass attempts": "passAttempts",
  "passing attempts": "passAttempts",
  "passing interceptions": "interceptions",
  "interceptions thrown": "interceptions",
  "rushing yards": "rushYards",
  "rushing attempts": "rushAttempts",
  carries: "rushAttempts",
  receptions: "receptions",
  "receiving yards": "recYards",
  "receiving yards+rushing": "rushRecYards",
  "anytime touchdown scorer": "anytimeTd",
  "longest rush": "longestRush",
  "longest reception": "longestReception",
  "kicking points": "kickingPoints",
  "field goals made": "fieldGoals",
  "extra points made": "extraPoints",
  sacks: "sacks",
  "solo tackles": "soloTackles",
  "assists+tackles": "tacklesAssists",
};

/**
 * Soccer stat keys → SoccerPropStat. DraftKings lists most soccer props as
 * ladders ("Shots Milestones": 1+, 2+, …) and the rest as Yes props.
 */
export const SOCCER_STAT_BY_KEY: Record<string, string> = {
  "anytime goalscorer": "goal",
  assists: "assist",
  shots: "shots",
  "shots on target": "shotsOnTarget",
  "goalkeeper saves": "saves",
  "to receive a card": "card",
  "fouls committed": "fouls",
};

/**
 * A quote in the typed tables' terms (side over/under, a number to beat): a
 * Yes prop is Over 0.5, the way the NBA's double-double and the NFL's anytime
 * TD are stored. Full-game only: the typed tables carry no period.
 */
export function typedSide(q: EspnPropQuote): { side: "over" | "under"; point: number } | null {
  if (q.period !== "game") return null;
  return q.side === "yes" ? { side: "over", point: 0.5 } : { side: q.side, point: q.point };
}
