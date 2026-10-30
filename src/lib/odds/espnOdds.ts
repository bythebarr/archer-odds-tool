/**
 * Free book prices from ESPN: every game ESPN lists carries one sportsbook's
 * current line (DraftKings today) — moneyline, spread and total with their
 * prices — on the scoreboard, and soccer's on each match's summary
 * ("pickcenter"). No key, no credits. It's one book, not a market, so it's
 * stored as that book's quotes and read as such: a real price to shop and to
 * run against ARCHR, not a consensus.
 *
 * Shapes are parsed defensively: ESPN omits fields freely, sends "EVEN" and
 * "OFF", and wraps soccer's scoreboard odds as [null].
 */
import type { OddsApiBookmaker, OddsApiMarket } from "./oddsApiClient";

/** ESPN's provider names, lowercased with spaces dropped → our book keys. */
const PROVIDER_KEYS: Record<string, string> = {
  draftkings: "draftkings",
  espnbet: "espnbet",
  thescorebet: "espnbet",
  caesars: "caesars",
  williamhill: "caesars",
  fanduel: "fanduel",
  betmgm: "betmgm",
};

export function providerKey(name: string | undefined): string | null {
  // ESPN writes the same book both ways ("DraftKings" on one league, "Draft Kings" on another).
  return name ? (PROVIDER_KEYS[name.toLowerCase().replace(/\s+/g, "")] ?? null) : null;
}

/** "+105" / "-120" / "EVEN" / 150 → American odds; null for "OFF", blanks and nonsense. */
export function parseAmerican(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && Math.abs(v) >= 100 ? Math.round(v) : null;
  if (typeof v !== "string") return null;
  const s = v.trim().toUpperCase();
  if (s === "EVEN" || s === "EV") return 100;
  const n = Number(s.replace(/^\+/, ""));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
}

/** "o5.5" / "u5.5" / "+1.5" / "-3" / 5.5 → number. */
export function parseLine(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = Number(v.trim().replace(/^[ou]/i, "").replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
}

interface Quote {
  close?: { odds?: string; line?: string };
  open?: { odds?: string; line?: string };
}

/** The scoreboard's odds object (US sports): moneyline / pointSpread / total, each side with open and close. */
export interface EspnScoreboardOdds {
  provider?: { name?: string };
  moneyline?: { home?: Quote; away?: Quote; draw?: Quote };
  pointSpread?: { home?: Quote; away?: Quote };
  total?: { over?: Quote; under?: Quote };
}

/** A match summary's pickcenter entry (soccer and everything else that has one). */
export interface EspnPickcenter {
  provider?: { name?: string };
  spread?: number;
  overUnder?: number;
  overOdds?: number;
  underOdds?: number;
  homeTeamOdds?: { moneyLine?: number; spreadOdds?: number };
  awayTeamOdds?: { moneyLine?: number; spreadOdds?: number };
  drawOdds?: { moneyLine?: number };
}

const latest = (q: Quote | undefined) => q?.close ?? q?.open;

function bookmaker(key: string, title: string, markets: OddsApiMarket[]): OddsApiBookmaker | null {
  const kept = markets.filter((m) => m.outcomes.length >= 2);
  return kept.length ? { key, title, last_update: new Date().toISOString(), markets: kept } : null;
}

/**
 * A scoreboard odds object as one bookmaker in The Odds API's shape, so it goes
 * through the same storage (and sanity checks) as any feed. Outcome names are
 * the home/away names given, which is how storage tells the sides apart.
 */
export function scoreboardOddsToBookmaker(o: EspnScoreboardOdds | null | undefined, home: string, away: string): OddsApiBookmaker | null {
  if (!o) return null;
  const key = providerKey(o.provider?.name) ?? "draftkings";
  const h2h: OddsApiMarket = { key: "h2h", outcomes: [] };
  const mlHome = parseAmerican(latest(o.moneyline?.home)?.odds);
  const mlAway = parseAmerican(latest(o.moneyline?.away)?.odds);
  const mlDraw = parseAmerican(latest(o.moneyline?.draw)?.odds);
  if (mlHome !== null && mlAway !== null) {
    h2h.outcomes.push({ name: home, price: mlHome }, { name: away, price: mlAway });
    if (mlDraw !== null) h2h.outcomes.push({ name: "Draw", price: mlDraw });
  }
  const spreads: OddsApiMarket = { key: "spreads", outcomes: [] };
  const sh = latest(o.pointSpread?.home);
  const sa = latest(o.pointSpread?.away);
  const shLine = parseLine(sh?.line);
  const saLine = parseLine(sa?.line);
  const shOdds = parseAmerican(sh?.odds);
  const saOdds = parseAmerican(sa?.odds);
  if (shLine !== null && saLine !== null && shOdds !== null && saOdds !== null) {
    spreads.outcomes.push({ name: home, price: shOdds, point: shLine }, { name: away, price: saOdds, point: saLine });
  }
  const totals: OddsApiMarket = { key: "totals", outcomes: [] };
  const ov = latest(o.total?.over);
  const un = latest(o.total?.under);
  const ovLine = parseLine(ov?.line);
  const unLine = parseLine(un?.line);
  const ovOdds = parseAmerican(ov?.odds);
  const unOdds = parseAmerican(un?.odds);
  if (ovLine !== null && unLine !== null && ovOdds !== null && unOdds !== null && ovLine === unLine) {
    totals.outcomes.push({ name: "Over", price: ovOdds, point: ovLine }, { name: "Under", price: unOdds, point: unLine });
  }
  return bookmaker(key, o.provider?.name ?? "DraftKings", [h2h, spreads, totals]);
}

/** A summary's pickcenter entry as one bookmaker. `spread` is the home side's number. */
export function pickcenterToBookmaker(p: EspnPickcenter | null | undefined, home: string, away: string): OddsApiBookmaker | null {
  if (!p) return null;
  const key = providerKey(p.provider?.name) ?? "draftkings";
  const h2h: OddsApiMarket = { key: "h2h", outcomes: [] };
  const mlHome = parseAmerican(p.homeTeamOdds?.moneyLine);
  const mlAway = parseAmerican(p.awayTeamOdds?.moneyLine);
  const mlDraw = parseAmerican(p.drawOdds?.moneyLine);
  if (mlHome !== null && mlAway !== null) {
    h2h.outcomes.push({ name: home, price: mlHome }, { name: away, price: mlAway });
    if (mlDraw !== null) h2h.outcomes.push({ name: "Draw", price: mlDraw });
  }
  const spreads: OddsApiMarket = { key: "spreads", outcomes: [] };
  const sh = parseAmerican(p.homeTeamOdds?.spreadOdds);
  const sa = parseAmerican(p.awayTeamOdds?.spreadOdds);
  if (typeof p.spread === "number" && sh !== null && sa !== null) {
    spreads.outcomes.push({ name: home, price: sh, point: p.spread }, { name: away, price: sa, point: -p.spread });
  }
  const totals: OddsApiMarket = { key: "totals", outcomes: [] };
  const ov = parseAmerican(p.overOdds);
  const un = parseAmerican(p.underOdds);
  if (typeof p.overUnder === "number" && ov !== null && un !== null) {
    totals.outcomes.push({ name: "Over", price: ov, point: p.overUnder }, { name: "Under", price: un, point: p.overUnder });
  }
  return bookmaker(key, p.provider?.name ?? "DraftKings", [h2h, spreads, totals]);
}
