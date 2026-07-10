import { listGamesWithLinesForDate, type GameWithLines } from "@/lib/queries/games";
import { marketConsensus } from "@/lib/odds/lineEconomics";
import { calculateEv, type ConsensusFairProbability } from "@/lib/odds/devig";
import { todayEt } from "@/lib/dateEt";
import { decimalToAmerican, formatAmerican, americanToImpliedProbability } from "@/lib/odds/americanOdds";
import { formatEv, formatPoint } from "@/lib/odds/format";

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
 * Covers MLB moneyline, spread (runline), and totals — all graded at the game's
 * main (modal) line. An explicit alt-line point is noted but still graded at the
 * main line for now (exact alt grading is a follow-up).
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

export type Market = "ml" | "spread" | "total";
export type TotalSide = "over" | "under";

/** Our command markets → the odds MarketType marketConsensus expects. */
const MARKET_TYPE = { ml: "h2h", spread: "spreads", total: "totals" } as const;

export interface BetCheckParams {
  market: Market;
  /** Team you're betting — identifies the game (and the side, for ml/spread). */
  team: string;
  /** American odds you're getting, as typed ("-120", "+105"). */
  price: string;
  /** over/under — required for totals, ignored otherwise. */
  side?: TotalSide;
  /** The point you took (spread/total), optional — informational only in v1. */
  line?: string;
}

/**
 * Grade a bet against its fair probability. Pure over `fairProb` + a display
 * `selection`, so every market shares one verdict/format and it's testable
 * without a DB. `note` carries any caveat (e.g. graded at the main line).
 */
export function gradeBet(selection: string, price: number, fairProb: number, note = ""): BetCheckResult {
  const ev = calculateEv(fairProb, price);
  const verdict = verdictFor(ev);
  const fairPrice = decimalToAmerican(1 / fairProb);
  const impliedPct = (americanToImpliedProbability(price) * 100).toFixed(1);
  const fairPct = (fairProb * 100).toFixed(1);
  const message =
    `🧮 **Bet Check** — ${selection} @ ${formatAmerican(price)}\n\n` +
    `${VERDICT_LINE[verdict]}\n` +
    `• Archer fair price: ~${formatAmerican(fairPrice)} (${fairPct}% to hit)\n` +
    `• Your price: ${formatAmerican(price)} (${impliedPct}% implied)\n` +
    `• Edge: **${formatEv(ev)} EV**` +
    (note ? `\n${note}` : "") +
    FOOTER;
  return { ok: true, message };
}

/** True when the user's typed point is (magnitude-wise) the game's main line. */
function isMainLine(input: string | undefined, modalPoint: number | null): boolean {
  if (input == null || modalPoint === null) return true; // nothing to compare = treat as main
  const n = Number(input.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && Math.abs(n - Math.abs(modalPoint)) < 1e-9;
}

function altNote(mainLabel: string): string {
  return `_Graded at the main line (${mainLabel}) — if you took a different number, read this as a reference; exact alt-line grading is coming._`;
}

export interface Resolved {
  fairProb: number | null;
  selection: string;
  note: string;
}

/**
 * Resolve a market's fair probability + display label from a game's consensus.
 * Pure (fake a consensus to test it): SIDE_A is home/over, SIDE_B is away/under,
 * and a spread's point flips sign for the away side. Returns an `error` string
 * for a missing totals side.
 */
export function resolveSelection(
  params: Pick<BetCheckParams, "market" | "side" | "line">,
  matchSide: "home" | "away",
  teamName: string,
  gameLabel: string,
  consensus: Pick<ConsensusFairProbability, "fairProbA" | "fairProbB" | "modalPoint">
): Resolved | { error: string } {
  const { fairProbA, fairProbB, modalPoint } = consensus;

  if (params.market === "total") {
    if (!params.side) return { error: "For a total, choose **over** or **under**." };
    const fairProb = params.side === "over" ? fairProbA : fairProbB;
    const label = `${params.side === "over" ? "Over" : "Under"}${modalPoint !== null ? ` ${modalPoint}` : ""} (${gameLabel})`;
    const note = isMainLine(params.line, modalPoint) ? "" : altNote(modalPoint !== null ? String(modalPoint) : "the posted total");
    return { fairProb, selection: label, note };
  }

  if (params.market === "spread") {
    const fairProb = matchSide === "home" ? fairProbA : fairProbB;
    const teamPoint = modalPoint === null ? null : matchSide === "home" ? modalPoint : -modalPoint;
    const label = `${teamName}${formatPoint(teamPoint, "spreads")}`;
    const note = isMainLine(params.line, teamPoint) ? "" : altNote(teamPoint !== null ? formatPoint(teamPoint, "spreads").trim() : "the posted line");
    return { fairProb, selection: label, note };
  }

  // moneyline
  const fairProb = matchSide === "home" ? fairProbA : fairProbB;
  return { fairProb, selection: `${teamName} ML`, note: "" };
}

/**
 * Full Bet Check for a slash command: parse, find today's MLB game for the team,
 * fair-price the chosen market, return a member-facing verdict string. Any
 * failure comes back as a friendly `ok:false` message (never throws).
 */
export async function runBetCheck(params: BetCheckParams, dateEt: string = todayEt()): Promise<BetCheckResult> {
  const price = parseAmericanPrice(params.price);
  if (price === null) {
    return { ok: false, message: `"${params.price}" isn't a valid American price. Try something like -120 or +105.` };
  }

  const games = await listGamesWithLinesForDate(dateEt);
  const result = matchGame(games, params.team);
  if ("error" in result) {
    const msg =
      result.error === "none"
        ? `No MLB game found today for "${params.team}". Check the spelling or try the team's city (e.g. "Yankees" or "NYY").`
        : `"${params.team}" matched more than one game today — be more specific (use the team name or abbreviation).`;
    return { ok: false, message: msg };
  }

  const { match } = result;
  const g = match.game.game;
  const gameLabel = `${g.awayTeam.abbreviation}/${g.homeTeam.abbreviation}`;
  const consensus = marketConsensus(match.game.lines, MARKET_TYPE[params.market]);

  const resolved = resolveSelection(params, match.side, match.teamName, gameLabel, consensus);
  if ("error" in resolved) return { ok: false, message: resolved.error };
  if (resolved.fairProb === null) {
    const marketName = params.market === "ml" ? "moneyline" : params.market;
    return { ok: false, message: `Not enough book coverage to fair-price that ${marketName} yet — check back closer to game time.` };
  }

  return gradeBet(resolved.selection, price, resolved.fairProb, resolved.note);
}
