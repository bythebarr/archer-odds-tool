/**
 * CONFIDENCE — how far to trust ARCHR's read of one bet. Not a probability
 * and not the edge: two bets can both read 60% with the same edge, and one
 * of them rests on a proven model, a long record that agrees and a settled
 * role, the other on six games, a questionable tag and a number that's way off
 * the books'. Confidence tells them apart.
 *
 *   ARCHR chance  how often it should hit (the one probability)
 *   ARCHR edge    that chance against the best price
 *   Confidence    how much the first two can be trusted on this bet (A–D)
 *
 * The score starts at BASE and each factor below moves it by a stated number
 * of points, so the grade is always explainable: every factor carries the
 * plain-language reason it moved (or didn't), and the player sheet lists them.
 * The cautious read (the record-backed check, lib/propModel/cautiousRead) is
 * one factor here, not a column of its own.
 *
 * The points come from the factor audit (scripts/audit-factors.ts, run
 * 2026-11-12 over 5,347 live tracked NBA prop leans plus the NBA and NFL
 * prop backtests at closing prices). What held up there:
 *
 *   - Projection distance from the line (|z|) matters most: leans where it
 *     barely cleared the line returned −18.6% on 1,614 bets (both date halves
 *     agreed), leans where it sat far off it +11.8% on 205.
 *   - ARCHR runs high on alt lines (+11.6 pts), overs (+8.1, NBA) and long
 *     prices (+11.4).
 *   - A record that agrees with ARCHR does NOT add confidence: those bets ran
 *     23 pts high in the NFL backtest (both halves). A hot streak is already in
 *     the price. The old cautious edge's bonus is gone; the record is context.
 *   - Disagreeing with the books by 8–15 pts was ARCHR's best range live
 *     (+6.5%, the close moved its way); past 15 pts it was its worst.
 *
 * CONTINUOUS FACTORS (2026-11-13, after docs/confidence-continuous-diagnosis.md).
 * Distance, market gap, sample and track used to move in steps, which piled
 * the board onto a dozen scores. They are now straight lines through the
 * same anchors, keeping each factor's range:
 *
 *   distance  −10 at |z| ≤ 0.15, 0 at 0.55, +10 at ≥ 0.95. |z| above
 *             Z_DEGENERATE is a collapsed projection spread (yes/no props),
 *             not distance: no credit, and the reason says so. Capped at Z_CAP.
 *   market    0 at a 3-pt gap, +5 at 11.5, 0 at 15, −15 by 18 (the old cliff
 *             at 15, ramped over 3 pts).
 *   sample    −20 at ≤ 2 games, −10 at 7.5, 0 at 15, +5 at ≥ 30.
 *   track     the report card's own record: its skill (Brier points ×1000,
 *             clamped −5..+10), weighted by how many outcomes graded it (full
 *             at 500), with the rest of the weight on −5 — so a thin card still
 *             costs, and only a long, good record earns the full +10. No card
 *             −5; a sport the blend doesn't price 0.
 *
 * scripts/backtest-confidence.ts re-grades the result. Pure.
 */
import { cautiousEdge } from "./canonical";
import type { Rate } from "@/lib/builder/types";

export type ConfidenceGrade = "A" | "B" | "C" | "D";

export interface ConfidenceInput {
  /** ARCHR chance on this side (null: no read, so no grade). */
  archr: number | null;
  /** The books' no-vig chance on this side; null without a two-sided market. */
  marketChance: number | null;
  /** Best price on this side, American; null when only a number is posted. */
  priceAmerican: number | null;
  /** His recent record at this line on this side (L10, or the season when L10 is thin). */
  rate: Rate;
  /** Games of his history behind the projection. */
  sampleGames: number;
  /** The blend report card's verdict for this stat ("trusted" is proven); undefined for sports the blend doesn't price. */
  blendVerdict?: string | null;
  /**
   * That card's record: skill (base-rate Brier − Brier, positive = better than
   * no skill) and outcomes graded. Null: no card. Omitted with a verdict: the
   * verdict word alone (+10 trusted, −5 otherwise), for callers without the record.
   */
  blendCard?: { skill: number; n: number } | null;
  /** Injury tag: "probable", "questionable", "doubtful", "day-to-day"…; null when clear. */
  injury?: string | null;
  /** NBA: projected minutes tonight, and his recent average (null when unknown). */
  minutes?: { projected: number; recent: number | null } | null;
  /** An alt rung rather than the book's main line. */
  alt?: boolean;
  /** How far the projection sits from the line, in its own spread: (mean − line) / sd. Null without a projection. */
  z?: number | null;
  /** Which side, and the sport: NBA overs have run high. */
  side?: "over" | "under";
  sport?: string;
}

export interface ConfidenceFactor {
  key: "track" | "sample" | "record" | "market" | "distance" | "side" | "minutes" | "injury" | "line" | "price";
  /** Points this factor moved the score (0 = context only). */
  effect: number;
  /** One plain sentence: what was found and why it matters. */
  text: string;
}

export interface Confidence {
  /** 0–100. */
  score: number;
  grade: ConfidenceGrade;
  factors: ConfidenceFactor[];
}

/**
 * Whether scripts/backtest-confidence has shown higher grades are where ARCHR's
 * read holds up. Until it has, every surface shows the grade's track record
 * (CONFIDENCE_TRACK_RECORD) beside it. The 2026-11-12 runs (700 NBA sides at
 * closing prices) returned DATA REQUIRED: after the audit reweight only 79
 * sides graded A or B, short of the 100 a verdict needs. Flip only on a
 * VALIDATED verdict.
 */
export const CONFIDENCE_VALIDATED = false;

/** What the grade's weights rest on, and where its own check stands — shown with every grade until it's validated. */
export const CONFIDENCE_TRACK_RECORD =
  "Factor anchors set from an audit of 5,347 graded live leans, scored continuously since Nov 13; the closing-price check hasn't shown higher scores earning more yet.";

/** Where every bet starts: neither trusted nor doubted. */
export const BASE = 55;
export const GRADE_CUTS: [ConfidenceGrade, number][] = [
  ["A", 75],
  ["B", 60],
  ["C", 45],
  ["D", -Infinity],
];

/** |z| beyond this is a collapsed projection spread, not distance. */
export const Z_DEGENERATE = 6;
/** Within range, |z| is capped here before it scores. */
export const Z_CAP = 2.5;
/** Outcomes graded for a report card's record to count in full. */
export const TRACK_FULL_N = 500;

/** Straight lines between anchor points, flat past the ends. */
export function interp(x: number, points: [number, number][]): number {
  if (x <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x0, y0] = points[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return points[points.length - 1]![1];
}
const round1 = (x: number) => Math.round(x * 10) / 10;

export const distanceEffect = (absZ: number) => round1(interp(Math.min(absZ, Z_CAP), [[0.15, -10], [0.55, 0], [0.95, 10]]));
export const marketEffect = (gap: number) => round1(interp(gap, [[0.03, 0], [0.115, 5], [0.15, 0], [0.18, -15]]));
export const sampleEffect = (games: number) => round1(interp(games, [[2, -20], [7.5, -10], [15, 0], [30, 5]]));
/** The card's record, weighted by its sample, the rest of the weight on −5. */
export function trackEffect(card: { skill: number; n: number }): number {
  const w = Math.min(1, Math.max(0, card.n) / TRACK_FULL_N);
  const record = Math.max(-5, Math.min(10, card.skill * 1000));
  return round1(w * record + (1 - w) * -5);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number) => `${Math.round(Math.abs(x) * 100)} pts`;
const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));

export const gradeOf = (score: number): ConfidenceGrade => GRADE_CUTS.find(([, cut]) => score >= cut)![0];

/** The grade and every factor behind it; null when ARCHR has no read on the bet. */
export function confidenceOf(c: ConfidenceInput): Confidence | null {
  if (c.archr === null) return null;
  const f: ConfidenceFactor[] = [];
  const add = (key: ConfidenceFactor["key"], effect: number, text: string) => f.push({ key, effect, text });
  const [hits, games] = c.rate;
  const priceChance = c.priceAmerican !== null ? implied(c.priceAmerican) : null;
  const books = c.marketChance ?? priceChance;

  // 1. Track record: has this stat's blend earned a passing report card on real closing prices?
  if (c.blendVerdict === undefined) add("track", 0, "This sport's props come from their own projection model; there's no blend report card to lean on yet.");
  else if (c.blendCard) {
    const e = trackEffect(c.blendCard);
    const skill = Math.round(c.blendCard.skill * 10000) / 10;
    add("track", e, `Report card: ${skill > 0 ? "+" : skill < 0 ? "−" : ""}${Math.abs(skill).toFixed(1)} skill vs no-skill on ${c.blendCard.n.toLocaleString("en-US")} graded${c.blendCard.n < TRACK_FULL_N ? ` (counts in full at ${TRACK_FULL_N})` : ""}.`);
  } else if (c.blendCard === null) add("track", -5, "No report card for this stat yet: nothing graded to lean on.");
  else if (c.blendVerdict === "trusted") add("track", 10, "ARCHR's numbers for this stat have a passing report card on real closing prices.");
  else add("track", -5, "ARCHR's numbers for this stat haven't earned a passing report card yet (see /models for its record).");

  // 2. How much history the projection rests on (linear in games).
  {
    const e = sampleEffect(c.sampleGames);
    add("sample", e, c.sampleGames < 10 ? `Only ${c.sampleGames} games of history: the projection leans on league averages.` : `${c.sampleGames} games of history behind the projection.`);
  }

  // 3. The record check (the cautious read): does his record at this line back the price, or only the model?
  if (priceChance !== null && games >= 5) {
    const recordRate = hits / games;
    const cautious = cautiousEdge(c.archr, c.rate, c.priceAmerican);
    const modelLikes = c.archr > priceChance;
    if (cautious !== null && cautious >= 0 && modelLikes)
      add("record", 0, `Record agrees: ${hits}/${games} here against the ${pct(priceChance)} the price implies. Context, not a plus: the books price streaks in, and bets like this have run high.`);
    else if (modelLikes && recordRate < priceChance - 0.1)
      add("record", -5, `Record doesn't back it: ${hits}/${games} here against the ${pct(priceChance)} the price implies. Only the model likes it.`);
    else if (!modelLikes && recordRate >= priceChance + 0.1)
      add("record", 0, `Hot record (${hits}/${games}), but the books have priced it in: at ${pct(priceChance)} implied, ARCHR (${pct(c.archr)}) sees no value left.`);
    else add("record", 0, `Record ${hits}/${games} here, close to what the price implies (${pct(priceChance)}).`);
  } else if (games < 5) add("record", -5, `Only ${games} recent games at this line: no record to check the read against.`);

  // 4. Disagreement with the books: a real disagreement is ARCHR's best range; a big gap is more often missing information than value.
  if (books !== null) {
    const gap = c.archr - books;
    const vs = c.marketChance !== null ? "the books' no-vig chance" : "the chance the price implies";
    const e = marketEffect(gap);
    if (gap > 0.15) add("market", e, `ARCHR is ${pts(gap)} above ${vs}: gaps this big are usually news the model hasn't seen (injury, role, rest).`);
    else if (e > 0) add("market", e, `ARCHR is ${pts(gap)} above ${vs}: a real disagreement, the range where its reads have held up best.`);
    else if (gap < -0.15) add("market", 0, `ARCHR is ${pts(gap)} below ${vs}: the books like this side far more than ARCHR does.`);
    else add("market", 0, `ARCHR is within ${pts(Math.max(Math.abs(gap), 0.01))} of ${vs}.`);
  }

  // 4b. Distance from the line: a projection that barely clears it is mostly vig; one far off it is where edges have held.
  if (c.z !== undefined && c.z !== null) {
    const z = Math.abs(c.z);
    if (!Number.isFinite(z) || z > Z_DEGENERATE) add("distance", 0, "Distance not scored: this projection has no real spread (a yes/no stat), so how far it sits from the line can't be measured.");
    else {
      const e = distanceEffect(z);
      const shown = Math.min(z, Z_CAP).toFixed(2);
      if (e < 0) add("distance", e, `The projection sits close to the line (${shown} of a typical swing): bets this close have mostly paid the vig.`);
      else if (e > 0) add("distance", e, `The projection sits off the line (${shown} of a typical swing): where ARCHR's edges have held up.`);
      else add("distance", 0, `The projection sits ${shown} of a typical swing from the line.`);
    }
  }

  // 4c. NBA overs have run high.
  if (c.sport === "nba" && c.side === "over") add("side", -5, "NBA overs: ARCHR's chances on overs have run high, so this side gets less benefit of the doubt.");

  // 5. Minutes (NBA): a role in flux or a small role widens everything.
  if (c.minutes) {
    const { projected, recent } = c.minutes;
    if (recent !== null && recent > 0 && Math.abs(projected / recent - 1) > 0.2)
      add("minutes", -10, `Minutes in flux: ${projected.toFixed(1)} projected against ${recent.toFixed(1)} lately.`);
    else if (projected < 18) add("minutes", -5, `Small role (${projected.toFixed(1)} projected minutes): a few minutes either way swing the line.`);
    else add("minutes", 0, `Settled role: ${projected.toFixed(1)} projected minutes${recent !== null ? `, ${recent.toFixed(1)} lately` : ""}.`);
  }

  // 6. Injury tag.
  const tag = c.injury?.toLowerCase() ?? null;
  if (tag === "questionable" || tag === "doubtful") add("injury", -15, `Listed ${tag}: he may not play, or play limited.`);
  else if (tag) add("injury", -5, `Listed ${tag}.`);

  // 7. Alt rungs are the model's weak spot (the tail of the distribution).
  if (c.alt) add("line", -10, "An alt line, not the book's main number: ARCHR's chances on alt rungs have run well high.");

  // 8. A number with no price yet can't be checked against a book.
  if (c.priceAmerican === null) add("price", -10, "No book has priced this yet: there's no price to measure the edge against.");
  else if (c.priceAmerican >= 130) add("price", -5, `A long price (+${c.priceAmerican}): ARCHR's chances on long shots have run high.`);

  const score = Math.max(0, Math.min(100, Math.round(BASE + f.reduce((s, x) => s + x.effect, 0))));
  return { score, grade: gradeOf(score), factors: f };
}

/** How a grade is shown everywhere: the letter, then the 0–100 score ("B 69"), so a 69 B reads apart from a 60 B. */
export const gradeLabel = (c: { grade: ConfidenceGrade; score: number }): string => `${c.grade} ${c.score}`;

/** One-line summary of the grade, for a tooltip. */
export function confidenceSummary(c: Confidence): string {
  const moved = c.factors.filter((x) => x.effect !== 0).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  return `Confidence ${gradeLabel(c)}${moved.length ? ": " + moved.slice(0, 3).map((x) => x.text.split(":")[0]).join("; ") : ""}`;
}

/** The grade as a board row carries it: the full factors live on the player sheet. */
export interface CompactConfidence {
  grade: ConfidenceGrade;
  score: number;
  /** The factors that moved it most, in a line: the row's tooltip. */
  why: string;
}

export function compactConfidence(c: Confidence | null): CompactConfidence | undefined {
  if (!c) return undefined;
  const moved = c.factors.filter((x) => x.effect !== 0).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  const why = moved.length ? moved.slice(0, 3).map((x) => `${x.effect > 0 ? "+" : "−"}${Math.abs(x.effect)} ${x.text.split(":")[0]}`).join(" · ") : "Nothing moved it either way";
  return { grade: c.grade, score: c.score, why };
}
