/**
 * Everything the projection needs to know about one player's game tonight,
 * read off the slate — one place, so the finder, the sheet and the server all
 * project with the same inputs. Client-safe (type-only slate import).
 */
import type { NbaPropsSlate, SlatePlayer } from "@/lib/queries/nbaProps";
import type { ProjectionContext } from "./projection";
import type { GameLogPoint } from "./propsMath";
import { NO_LINES } from "@/lib/propModel/environment";
import { projectNbaMinutes } from "./minutes";
import { nbaEnvironment } from "./environment";

type SlateInputs = Pick<NbaPropsSlate, "defense" | "absences" | "lines"> & Partial<Pick<NbaPropsSlate, "positionRates" | "teamDates" | "date">>;

export function nbaProjectionContext(slate: SlateInputs, player: SlatePlayer): ProjectionContext {
  const team = player.team?.abbreviation;
  return {
    defense: slate.defense,
    opponent: player.opponent?.abbreviation ?? null,
    positionGroup: player.positionGroup,
    absences: team ? slate.absences[team] : undefined,
    lines: slate.lines[player.gameId] ?? NO_LINES,
    isHome: player.venue === null ? null : player.venue === "home",
    baselineTotal: team ? (slate.defense.teams[team]?.combinedPoints ?? null) : null,
    positionRates: player.positionGroup ? slate.positionRates?.[player.positionGroup] : undefined,
    date: slate.date,
    team,
    teamDates: team ? slate.teamDates?.[team] : undefined,
  };
}

/** His projected minutes tonight, the same figure the props projection uses (blowout trim included); null without a game played. */
export function nbaTonightMinutes(slate: SlateInputs, player: SlatePlayer, logs: GameLogPoint[]): number | null {
  const ctx = nbaProjectionContext(slate, player);
  const m = projectNbaMinutes(logs, { date: ctx.date, team: ctx.team, teamDates: ctx.teamDates, absences: ctx.absences });
  if (!m) return null;
  return m.minutes * nbaEnvironment(ctx.lines ?? NO_LINES, ctx.isHome ?? null, "points", m.minutes, null).minutesFactor;
}
