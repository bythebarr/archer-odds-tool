import { listGamesWithLinesForDate, type GameWithLines } from "@/lib/queries/games";
import { marketConsensus } from "@/lib/odds/lineEconomics";
import { calculateEv } from "@/lib/odds/devig";
import { todayEt } from "@/lib/dateEt";
import { decimalToAmerican, formatAmerican, americanToImpliedProbability } from "@/lib/odds/americanOdds";
import { formatEv } from "@/lib/odds/format";

/**
 * "Bet Check" — grade a member's own moneyline bet against Archer's fair-value
 * (de-vigged market consensus). This is the MARKET lens, NOT Archer EV: it tells
 * a user whether the price THEY have is good/fair/poor value.
 *
 * Deliberately an ANALYSIS tool, not an odds feed. It returns a verdict + a
 * derived fair-price estimate + the EV — never a live book-by-book price list.
 * That distinction is what keeps it clear of The Odds API's redistribution
 * clause (grade value, don't shop prices), and the interaction reply is
 * ephemeral (asker-only), so it never becomes a public odds board.
 *
 * v1 scope: MLB moneyline. Spreads/totals need a line param + point matching —
 * a clean follow-up (the consensus math already generalizes via marketConsensus).
 */

export type BetVerdict = "sharp" | "fair" | "poor";

/** >= this EV vs fair = you're getting the better of it. Tunable. */
const SHARP_EV = 0.02;
/** <= this EV vs fair = you're paying over fair value. Tunable. */
const POOR_EV = -0.02;

export function verdictFor(ev: number): BetVerdict {
  if (ev >= SHARP_EV) return "sharp";
  if (ev <= POOR_EV) return "poor";
  return "fair";
}

/**
 * Parse a user-typed American price: "-120", "+105", "120" → -120 / 105 / 120.
 * Bare positive numbers are treated as plus-money (+120). Rejects nonsense and
 * the invalid -99..99 gap (no such American price).
 */
export function parseAmericanPrice(input: string): number | null {
  const cleaned = input.trim().replace(/\s+/g, "");
  if (!/^[+-]?\d{2,5}$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || (n > -100 && n < 100)) return null;
  return n;
}

interface TeamLike {
  name: string;
  abbreviation: string;
}

/** True if the query names this team — exact abbr/name, or a word/substring of the full name (so "yankees" or "nyy" both hit "New York Yankees"). */
export function teamMatches(team: TeamLike, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const name = team.name.toLowerCase();
  const abbr = team.abbreviation.toLowerCase();
  return abbr === q || name === q || name.split(/\s+/).includes(q) || name.includes(q);
}

export interface GameMatch {
  game: GameWithLines;
  side: "home" | "away";
  teamName: string;
}

/**
 * Resolve which game+side the query refers to. Returns the single match, or a
 * reason it couldn't ("none" / "ambiguous") so the caller can guide the user
 * instead of silently fair-pricing the wrong team.
 */
export function matchGame(
  games: GameWithLines[],
  query: string
): { match: GameMatch } | { error: "none" | "ambiguous" } {
  const hits: GameMatch[] = [];
  for (const gw of games) {
    const { homeTeam, awayTeam } = gw.game;
    if (teamMatches(homeTeam, query)) hits.push({ game: gw, side: "home", teamName: homeTeam.name });
    else if (teamMatches(awayTeam, query)) hits.push({ game: gw, side: "away", teamName: awayTeam.name });
  }
  if (hits.length === 0) return { error: "none" };
  // Same team can only appear once/day, so >1 hit = the query was too broad
  // (e.g. "new york" → Yankees and Mets).
  if (hits.length > 1) return { error: "ambiguous" };
  return { match: hits[0] };
}

export interface BetCheckResult {
  ok: boolean;
  message: string;
}

const FOOTER = "\n\n_Research only · not betting advice · fair value from de-vigged market consensus._";

const VERDICT_LINE: Record<BetVerdict, string> = {
  sharp: "✅ **Good value** — you're getting a better number than the model's fair price.",
  fair: "➖ **Fair** — priced about right, no real edge either way.",
  poor: "⚠️ **Poor value** — you're paying over the model's fair price.",
};

/**
 * Grade a moneyline bet. Pure over the fair probability so the verdict/format is
 * testable without a DB; runBetCheck does the fetch+match then calls this.
 */
export function gradeMoneyline(teamName: string, price: number, fairProb: number): BetCheckResult {
  const ev = calculateEv(fairProb, price);
  const verdict = verdictFor(ev);
  const fairPrice = decimalToAmerican(1 / fairProb);
  const impliedPct = (americanToImpliedProbability(price) * 100).toFixed(1);
  const fairPct = (fairProb * 100).toFixed(1);
  const message =
    `🧮 **Bet Check** — ${teamName} ML @ ${formatAmerican(price)}\n\n` +
    `${VERDICT_LINE[verdict]}\n` +
    `• Archer fair price: ~${formatAmerican(fairPrice)} (${fairPct}% to win)\n` +
    `• Your price: ${formatAmerican(price)} (${impliedPct}% implied)\n` +
    `• Edge: **${formatEv(ev)} EV**` +
    FOOTER;
  return { ok: true, message };
}

/**
 * Full Bet Check for a slash command: parse, find today's MLB game for the team,
 * fair-price the moneyline, return a member-facing verdict string. Any failure
 * comes back as a friendly `ok:false` message (never throws at the caller).
 */
export async function runBetCheck(
  teamInput: string,
  priceInput: string,
  dateEt: string = todayEt()
): Promise<BetCheckResult> {
  const price = parseAmericanPrice(priceInput);
  if (price === null) {
    return { ok: false, message: `"${priceInput}" isn't a valid American price. Try something like -120 or +105.` };
  }

  const games = await listGamesWithLinesForDate(dateEt);
  const result = matchGame(games, teamInput);
  if ("error" in result) {
    const msg =
      result.error === "none"
        ? `No MLB game found today for "${teamInput}". Check the spelling or try the team's city (e.g. "Yankees" or "NYY").`
        : `"${teamInput}" matched more than one game today — be more specific (use the team name or abbreviation).`;
    return { ok: false, message: msg };
  }

  const { match } = result;
  const consensus = marketConsensus(match.game.lines, "h2h");
  const fairProb = match.side === "home" ? consensus.fairProbA : consensus.fairProbB;
  if (fairProb === null) {
    return { ok: false, message: `Not enough book coverage to fair-price ${match.teamName} yet — check back closer to game time.` };
  }

  return gradeMoneyline(match.teamName, price, fairProb);
}
