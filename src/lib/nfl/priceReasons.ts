/**
 * What an NFL prop's projection weighed, for the player sheet's Confidence
 * panel: the matchup, the game's volume and script, teammates out, and how the
 * opponent ranks against his position. Each reason is marked for or against
 * the chosen side, like Hottest Tonight's NBA reasons. Pure.
 */
import type { NflStatMatchup } from "./matchup";

export interface NflReasonInput {
  side: "over" | "under";
  statShort: string;
  opponent: string | null;
  position: string | null;
  matchupFactor: number;
  volumeFactor: number;
  scriptFactor: number;
  spread: number | null;
  absence: { names: string[]; perGame: number } | null;
  /** His usual per-game average, to say which way the absence pushes. */
  mean: number;
  def: NflStatMatchup | null;
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;

export function nflPriceReasons(r: NflReasonInput): { text: string; supports: boolean | null }[] {
  const up = r.side === "over";
  const out: { text: string; supports: boolean | null }[] = [];
  const add = (text: string, pushesUp: boolean) => out.push({ text, supports: pushesUp === up });
  const opp = r.opponent ?? "the opponent";
  if (Math.abs(r.matchupFactor - 1) >= 0.04)
    add(`${opp} ${r.matchupFactor > 1 ? "gives up" : "holds"} ${pct(r.matchupFactor - 1)} ${r.matchupFactor > 1 ? "more" : "less"} ${r.statShort} than average`, r.matchupFactor > 1);
  if (r.def) {
    const top = r.def.rank <= Math.ceil(r.def.of / 4);
    const bottom = r.def.rank > r.def.of - Math.ceil(r.def.of / 4);
    if (top || bottom) add(`${opp} ranks ${r.def.rank}${["th", "st", "nd", "rd"][r.def.rank % 10 > 3 || Math.floor(r.def.rank / 10) === 1 ? 0 : r.def.rank % 10]} of ${r.def.of} in ${r.statShort} allowed to ${r.def.position}s`, top);
  }
  if (Math.abs(r.volumeFactor - 1) >= 0.03) add(`Game total points to ${r.volumeFactor > 1 ? "more" : "fewer"} plays than his usual games`, r.volumeFactor > 1);
  if (Math.abs(r.scriptFactor - 1) >= 0.03 && r.spread !== null)
    add(`${r.spread > 0 ? `${r.spread}-point underdog` : `${Math.abs(r.spread)}-point favorite`}: the expected game script ${r.scriptFactor > 1 ? "adds" : "takes"} volume for this stat`, r.scriptFactor > 1);
  if (r.absence) add(`With ${r.absence.names.join(" & ")} out: ${r.absence.perGame.toFixed(1)} a game in those games`, r.absence.perGame > r.mean);
  const order = (x: { supports: boolean | null }) => (x.supports === true ? 0 : x.supports === false ? 1 : 2);
  return out.sort((a, b) => order(a) - order(b));
}
