/**
 * Everything the projection needs to know about one player's game this week,
 * read off the slate — shared by the finder, the sheet and the server so they
 * project with the same inputs. Client-safe (type-only slate import).
 */
import type { NflPropsSlate, NflSlatePlayer } from "@/lib/queries/nflProps";
import type { NflProjectionContext } from "./projection";
import { NO_LINES } from "@/lib/propModel/environment";

type SlateInputs = Pick<NflPropsSlate, "defense" | "absences" | "lines" | "teamPoints">;

export function nflProjectionContext(slate: SlateInputs, player: NflSlatePlayer): NflProjectionContext {
  const team = player.team?.abbreviation;
  return {
    defense: slate.defense,
    opponent: player.opponent?.abbreviation ?? null,
    position: player.position,
    absences: team ? slate.absences[team] : undefined,
    lines: slate.lines[player.gameId] ?? NO_LINES,
    isHome: player.venue === null ? null : player.venue === "home",
    baselinePoints: team ? (slate.teamPoints[team] ?? null) : null,
  };
}
