/**
 * `/value` — the ask-the-bot lookup behind #value-check.
 *
 * The successor to the old MLB-only `/betcheck`, rebuilt to the owner's spec:
 * ANY sport, ANY market, and BOTH EV lenses — on a play the member is looking
 * at, not just one of ours. That last part is the point. A room that only grades
 * its own picks is a tout room; one that will price *your* bet is a tool.
 *
 * How it works: the engine has already priced every play on today's board, so a
 * lookup is a match against that board plus a re-price at the member's number.
 *
 * The re-price is the subtle bit. A play carries its EV *at our best price*, not
 * a probability — but EV and probability are the same fact in different clothes
 * (ev = p·decimal − 1), so the implied probability recovers exactly, and the EV
 * at any other price follows. That's what lets us answer "is -135 still worth
 * it?" when our board shows -120.
 */
import { americanToDecimal } from "@/lib/odds/americanOdds";
import { calculateEv } from "@/lib/odds/devig";
import type { Play } from "@/lib/engine";

/** Above this, the price is genuinely good; below the negative, genuinely bad. */
export const GOOD_EV = 0.02;
export const POOR_EV = -0.02;

/**
 * Recover the probability behind a play's EV at the price it was quoted on.
 * Inverse of `calculateEv`: ev = p·dec − 1  ⇒  p = (ev + 1) / dec.
 */
export function impliedProb(ev: number, atPrice: number): number {
  return (ev + 1) / americanToDecimal(atPrice);
}

/** That same probability's EV at a different price — the whole re-price. */
export function evAtPrice(ev: number, quotedAt: number, theirPrice: number): number {
  return calculateEv(impliedProb(ev, quotedAt), theirPrice);
}

export type Lens = "model" | "market";
export type Verdict = "good" | "fair" | "poor" | "mixed" | "unknown";

export interface ValueResult {
  play: Play;
  theirPrice: number;
  /** EV at THEIR price, per lens. Null when that lens doesn't cover this play. */
  modelEv: number | null;
  marketEv: number | null;
  verdict: Verdict;
  /** Set when our board has a better number than they're getting. */
  betterPrice: { price: number; book: string } | null;
}

function bandFor(ev: number): "good" | "fair" | "poor" {
  if (ev >= GOOD_EV) return "good";
  if (ev <= POOR_EV) return "poor";
  return "fair";
}

/**
 * Judge a price against both lenses.
 *
 * The lenses genuinely disagree sometimes — the model can love a number the
 * market hates — and collapsing that into one confident answer would be a lie
 * about how much we know. So agreement produces a verdict and disagreement
 * produces "mixed", with both numbers shown either way. Owner's posture
 * throughout: here's everything, you judge.
 */
export function evaluate(play: Play, theirPrice: number): ValueResult {
  const modelEv =
    play.modelEv !== null ? evAtPrice(play.modelEv, play.bestPrice, theirPrice) : null;
  const marketEv =
    play.marketEv !== null ? evAtPrice(play.marketEv, play.bestPrice, theirPrice) : null;

  const bands = [modelEv, marketEv].filter((e): e is number => e !== null).map(bandFor);
  let verdict: Verdict;
  if (!bands.length) verdict = "unknown";
  else if (bands.every((b) => b === bands[0])) verdict = bands[0];
  else if (bands.includes("good") && bands.includes("poor")) verdict = "mixed";
  // One lens is neutral and the other isn't — take the one with an opinion.
  else verdict = bands.find((b) => b !== "fair") ?? "fair";

  // Only flag a better number when ours actually beats theirs. Equal prices, or
  // a member who beat us, get nothing — nobody needs to be told they did fine.
  const better =
    americanToDecimal(play.bestPrice) > americanToDecimal(theirPrice)
      ? { price: play.bestPrice, book: play.bestBookName }
      : null;

  return { play, theirPrice, modelEv, marketEv, verdict, betterPrice: better };
}

/**
 * Find the plays a member's text might mean.
 *
 * Substring match over the selection label — deliberately loose, because members
 * type "yankees" or "judge", not "New York Yankees ML". Ambiguity is returned
 * rather than guessed at: picking one of three matching plays and confidently
 * pricing the wrong one is worse than asking which they meant.
 */
export function matchPlays(query: string, plays: Play[]): Play[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = plays.filter((p) => p.selection.label.toLowerCase().includes(q));
  // Exact label match wins outright — "Over 8.5" shouldn't be ambiguous with
  // "Over 8.5" in another game if one is typed exactly.
  const exact = hits.filter((p) => p.selection.label.toLowerCase() === q);
  return exact.length ? exact : hits;
}

const VERDICT_CHROME: Record<Verdict, { icon: string; headline: string }> = {
  good: { icon: "✅", headline: "Good value" },
  fair: { icon: "➖", headline: "Fair price" },
  poor: { icon: "❌", headline: "Poor value" },
  mixed: { icon: "⚠️", headline: "Mixed signals" },
  unknown: { icon: "❓", headline: "No read" },
};

function pct(ev: number): string {
  return `${ev >= 0 ? "+" : ""}${(ev * 100).toFixed(1)}%`;
}

function american(p: number): string {
  return p > 0 ? `+${p}` : `${p}`;
}

/** The member-facing reply. Ephemeral in Discord, so it never becomes a public board. */
export function renderVerdict(r: ValueResult): string {
  const { icon, headline } = VERDICT_CHROME[r.verdict];
  const lines = [
    `${icon} **${headline}** — ${r.play.selection.label} at ${american(r.theirPrice)}`,
    "",
  ];

  if (r.modelEv !== null) lines.push(`🧠 Model: **${pct(r.modelEv)}** at your number`);
  if (r.marketEv !== null) lines.push(`📊 Market: **${pct(r.marketEv)}** at your number`);
  if (r.modelEv === null && r.marketEv === null) {
    lines.push("_We don't have a priced read on this one — no model and no market consensus._");
  }

  if (r.verdict === "mixed") {
    lines.push("", "_The two lenses disagree here. That's a coin-flip dressed as an edge — we'd pass._");
  }

  if (r.betterPrice) {
    lines.push(
      "",
      `💰 Better number available: **${american(r.betterPrice.price)}** at ${r.betterPrice.book}.`
    );
  }

  lines.push("", "_Research only, not advice. 21+._");
  return lines.join("\n");
}

/** Too many matches to answer — ask which, rather than pricing the wrong play. */
export function renderAmbiguous(query: string, hits: Play[]): string {
  const list = hits.slice(0, 6).map((p) => `• ${p.selection.label}`).join("\n");
  return [
    `❓ "${query}" matches ${hits.length} plays on today's board:`,
    "",
    list,
    hits.length > 6 ? `_…and ${hits.length - 6} more._` : "",
    "",
    "Try again with more of the name.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderNoMatch(query: string): string {
  return [
    `❓ Nothing on today's board matches "${query}".`,
    "",
    "That usually means the event isn't today, or we don't price that market yet. Check the spelling and try the team or player name.",
  ].join("\n");
}
