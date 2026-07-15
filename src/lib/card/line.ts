/**
 * Card line formatters — the member-facing "capper line" voice, shared by the
 * Discord poster (postCard) AND the sport adapters that pre-render each play's
 * line into `Play.display.line` (sport-engine Phase 3). Kept in a neutral module
 * so the engine can produce card lines WITHOUT importing the Discord layer — the
 * engine's zero-`@/lib/discord`-imports invariant (Phase 3a) stays intact.
 *
 * Pure: only odds/date/Kelly formatters, no I/O. Moved verbatim from postCard so
 * the rendered strings are byte-for-byte what the poster produced before the
 * board was routed through the registry (a parity test locks this).
 */
import { formatEv } from "@/lib/odds/format";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { unitsFor } from "@/lib/betting/kelly";
import type { OddsPlay } from "@/lib/queries/oddsPool";
import type { UfcBestPlay, UfcFinishLean } from "@/lib/discord/ufcBestPlays";

const SPORT_LABEL: Record<string, string> = { mlb: "MLB", tennis: "TEN", soccer: "SOC", ufc: "UFC" };
const KIND_LABEL: Record<string, string> = { ml: "ML", spread: "SPR", total: "TOT", prop: "PROP" };

/** e.g. "MLB TOT" — the backtick tag prefixing a play's line. */
export function tagFor(p: Pick<OddsPlay, "sport" | "kind">): string {
  return `${SPORT_LABEL[p.sport] ?? p.sport.toUpperCase()} ${KIND_LABEL[p.kind] ?? ""}`.trim();
}

/** away @ home, using book abbreviations when available (e.g. "NYY @ BOS"). */
function matchupLabel(p: Pick<OddsPlay, "home" | "away">): string {
  return `${p.away.meta ?? p.away.name} @ ${p.home.meta ?? p.home.name}`;
}

/**
 * The member-facing selection. Moneyline/spread name a team so they're self-
 * identifying, but a total ("Over 8.5") or draw names no game — so prefix the
 * matchup, else members see a line with no idea WHICH game it's on.
 */
export function selectionDisplay(p: Pick<OddsPlay, "side" | "selectionLabel" | "home" | "away">): string {
  const needsMatchup = p.side === "over" || p.side === "under" || p.side === "draw";
  return needsMatchup ? `${matchupLabel(p)} ${p.selectionLabel}` : p.selectionLabel;
}

/** A play's first pitch / start as a compact ET stamp, e.g. "7:05p". */
function startTimeLabel(d: Date): string {
  const s = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(d);
  return s.replace(/\s?AM$/, "a").replace(/\s?PM$/, "p");
}

/** e.g. `MLB TOT` **NYY @ BOS Over 8.5** +102 · FanDuel · +6.2% Edge · 1.5u · 7:05p ET */
export function playLine(p: OddsPlay): string {
  const units = p.modelEv !== null ? ` · ${unitsFor(p.modelEv, p.bestPrice)}u` : "";
  const start = p.startUtc ? ` · ${startTimeLabel(p.startUtc)} ET` : "";
  return `\`${tagFor(p)}\` **${selectionDisplay(p)}** ${formatAmerican(p.bestPrice)} · ${p.bestBookName} · ${formatEv(p.modelEv)} Edge${units}${start}`;
}

/** The funnel tease for an MLB play — tag + selection only, no EV/book/units. */
export function mlbFreeLean(p: OddsPlay): string {
  return `\`${tagFor(p)}\` **${selectionDisplay(p)}**`;
}

const FINISH_METHOD_LABEL: Record<string, string> = { ko: "KO/TKO", submission: "submission", decision: "decision" };

/**
 * The fighter-math finish lean, in the card's analyst voice — "sees KO/TKO ~R2
 * (61% finish)" for a stoppage read, "sees a decision (55% to distance)" for a
 * points read. Turns the raw EV into a breakdown a capper would actually write.
 */
function finishLeanLabel(lean: UfcFinishLean): string {
  if (lean.method === "decision") {
    return `sees a decision (${Math.round(lean.distanceProb * 100)}% to distance)`;
  }
  const method = FINISH_METHOD_LABEL[lean.method];
  const round = lean.round ? ` ~R${lean.round}` : "";
  return `sees ${method}${round} (${Math.round(lean.finishProb * 100)}% finish)`;
}

/** e.g. 🏆 **Alessandro Costa** +150 · DraftKings · +7.2% Edge · 1.5u · over Ode' Osbourne (58% model) · sees KO/TKO ~R2 (61% finish) */
export function ufcPlayLine(p: UfcBestPlay): string {
  const marker = p.titleBout ? "🏆 " : "";
  const lean = p.finishLean ? ` · ${finishLeanLabel(p.finishLean)}` : "";
  return (
    `${marker}**${p.pickName}** ${formatAmerican(p.bestPrice)} · ${p.bestBookName} · ` +
    `${formatEv(p.archerEv)} Edge · ${unitsFor(p.archerEv, p.bestPrice)}u · over ${p.opponentName} (${Math.round(p.prob * 100)}% model)${lean}`
  );
}

/** The funnel tease for a UFC play — pick over opponent, no EV/book/units. */
export function ufcFreeLean(p: UfcBestPlay): string {
  return `\`UFC\` **${p.pickName}** over ${p.opponentName}`;
}

/**
 * UFC event date → "Sat Jul 12" (mirrors the /ufc list's formatter). eventDate
 * is a Cito date-only value stored at UTC midnight, so it MUST be formatted in
 * UTC — formatting in ET rolls it back to the previous evening ("Jul 11" → "Jul 10").
 */
export function prettyEventDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
