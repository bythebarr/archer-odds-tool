/**
 * Who's on which team today, from ESPN's team rosters (free, unkeyed):
 *   /apis/site/v2/sports/{sport}/{league}/teams/{code}/roster
 *
 * A player's team otherwise comes from his last box score, so after a trade or
 * a signing he stays on his old team until he plays for the new one: tonight's
 * props would sit under the wrong game, his old teammates would be read as
 * losing him, and his new ones wouldn't. The roster sync moves every player we
 * know (one with game logs) to the team ESPN lists him on. Players ESPN doesn't
 * list anywhere (released, unsigned) are left as they are.
 */
import { prisma } from "@/lib/prisma";
import { espnTeamCode } from "@/lib/logos";

const BASE = "https://site.api.espn.com/apis/site/v2/sports";
const PATH = { nba: "basketball/nba", nfl: "football/nfl" } as const;
type RosterSport = keyof typeof PATH;

interface RosterAthlete {
  id?: string;
}

/** Athlete ids on a roster payload: NBA lists athletes flat, NFL in groups (offense, defense, …) of items. */
export function rosterAthleteIds(payload: unknown): string[] {
  const athletes = (payload as { athletes?: unknown[] } | null)?.athletes ?? [];
  const ids: string[] = [];
  for (const a of athletes) {
    const group = a as { items?: RosterAthlete[] } & RosterAthlete;
    if (Array.isArray(group.items)) {
      for (const i of group.items) if (i.id) ids.push(String(i.id));
    } else if (group.id) {
      ids.push(String(group.id));
    }
  }
  return ids;
}

export async function syncRosters(sport: RosterSport): Promise<{ sport: RosterSport; teams: number; moved: number; failed: string[] }> {
  // The league's clubs: every team that has hosted one of its games.
  const teams = await prisma.team.findMany({ where: { homeGames: { some: { sport } } }, select: { id: true, abbreviation: true } });
  const failed: string[] = [];
  let moved = 0;
  // A few at a time: 30 requests, kind to ESPN and inside a function's minute.
  for (let i = 0; i < teams.length; i += 6) {
    await Promise.all(
      teams.slice(i, i + 6).map(async (t) => {
        try {
          const res = await fetch(`${BASE}/${PATH[sport]}/teams/${espnTeamCode(sport, t.abbreviation)}/roster`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error(String(res.status));
          const ids = rosterAthleteIds(await res.json());
          // An empty roster from a live feed is a bad answer, not a team with no players.
          if (ids.length < 5) throw new Error(`only ${ids.length} players`);
          const where = { espnAthleteId: { in: ids }, NOT: { teamId: t.id } };
          const { count } = sport === "nba" ? await prisma.nbaPlayer.updateMany({ where, data: { teamId: t.id } }) : await prisma.nflPlayer.updateMany({ where, data: { teamId: t.id } });
          moved += count;
        } catch (error) {
          failed.push(`${t.abbreviation}: ${error instanceof Error ? error.message : String(error)}`);
        }
      })
    );
  }
  return { sport, teams: teams.length, moved, failed };
}
