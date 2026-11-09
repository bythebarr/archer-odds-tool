/**
 * Everything the projection needs to know about one player's game this week,
 * read off the slate — shared by the finder, the sheet and the server so they
 * project with the same inputs. Client-safe (type-only slate import).
 */
import type { NflPropsSlate, NflSlatePlayer } from "@/lib/queries/nflProps";
import type { NflProjectionContext } from "./projection";
import { NO_LINES } from "@/lib/propModel/environment";

type SlateInputs = Pick<NflPropsSlate, "defense" | "absences" | "absenceImpacts" | "lines" | "teamPoints"> & Partial<Pick<NflPropsSlate, "modelLines" | "weather">>;

export function nflProjectionContext(slate: SlateInputs, player: NflSlatePlayer): NflProjectionContext {
  const team = player.team?.abbreviation;
  const opponent = player.opponent?.abbreviation;
  const impactOf = (abbr: string | undefined) =>
    abbr ? (slate.absenceImpacts[abbr] ?? []).reduce((a, m) => a + Math.max(0, m.impact), 0) : 0;
  // The model's own totals first: they already carry both teams' absences
  // (adjustExpected), so the absence re-read of the lines must NOT apply on
  // top of them — it exists to make the MARKET lines absence-aware, and
  // only those get it.
  const modelLines = slate.modelLines?.[player.gameId];
  return {
    defense: slate.defense,
    opponent: opponent ?? null,
    position: player.position,
    absences: team ? slate.absences[team] : undefined,
    ownAbsenceImpact: modelLines ? 0 : impactOf(team),
    opponentAbsenceImpact: modelLines ? 0 : impactOf(opponent),
    lines: modelLines ?? slate.lines[player.gameId] ?? NO_LINES,
    isHome: player.venue === null ? null : player.venue === "home",
    baselinePoints: team ? (slate.teamPoints[team] ?? null) : null,
    weather: slate.weather?.[player.gameId] ?? null,
  };
}
