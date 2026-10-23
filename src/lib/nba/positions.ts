/**
 * Player positions, for defense by position: how much an opponent gives up to
 * guards, forwards and centers separately. ESPN lists positions on box scores
 * and team rosters (PG, SG, G, SF, PF, F, C, and hybrids like G-F); we bucket
 * them into three groups, since books' players move between the 1–2 and 3–4
 * spots too often for finer cuts to hold a sample.
 *
 * Box scores fill a player's position as games are logged. syncNbaPositions
 * fills the rest from the 30 rosters, then stamps the group onto every game log
 * that doesn't have one yet — so history logged before positions were stored
 * joins the by-position sums too.
 */
import { prisma } from "@/lib/prisma";
import { espnTeamCode } from "@/lib/logos";
import { NBA_TEAMS } from "./teams";
import { positionGroup } from "./positionGroups";

export { positionGroup, POSITION_GROUP_LABEL, type PositionGroup } from "./positionGroups";

interface RosterResponse {
  athletes?: ({ id?: string; position?: { abbreviation?: string } } | { items?: { id?: string; position?: { abbreviation?: string } }[] })[];
}

/** espnAthleteId → position abbreviation, from one team-roster payload. Handles flat and grouped athlete lists. */
export function parseEspnRoster(payload: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const body = payload as RosterResponse | null | undefined;
  const add = (a: { id?: string; position?: { abbreviation?: string } }) => {
    if (a.id && a.position?.abbreviation) out.set(a.id, a.position.abbreviation);
  };
  for (const entry of body?.athletes ?? []) {
    if ("items" in entry && Array.isArray(entry.items)) entry.items.forEach(add);
    else add(entry as { id?: string; position?: { abbreviation?: string } });
  }
  return out;
}

const ROSTER_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams";

export interface SyncNbaPositionsSummary {
  missingBefore: number;
  playersUpdated: number;
  logsStamped: number;
  failures: string[];
}

/**
 * Fills positions for players who lack one (from the rosters, only when any
 * do), then stamps groups onto unstamped logs. Cheap when there's nothing to
 * do: one count, one update.
 */
export async function syncNbaPositions(): Promise<SyncNbaPositionsSummary> {
  // Only players active in the last month count: a retired player missing from
  // every roster would otherwise trigger 30 roster fetches on every run.
  const recent = new Date(Date.now() - 30 * 86_400_000);
  const missingBefore = await prisma.nbaPlayer.count({
    where: { positionGroup: null, gameLogs: { some: { gameDate: { gte: recent } } } },
  });
  let playersUpdated = 0;
  const failures: string[] = [];

  if (missingBefore > 0) {
    for (const team of NBA_TEAMS) {
      try {
        const res = await fetch(`${ROSTER_URL}/${espnTeamCode("nba", team.abbreviation)}/roster`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        for (const [espnAthleteId, position] of parseEspnRoster(await res.json())) {
          const group = positionGroup(position);
          if (!group) continue;
          const { count } = await prisma.nbaPlayer.updateMany({
            where: { espnAthleteId, positionGroup: null },
            data: { position, positionGroup: group },
          });
          playersUpdated += count;
        }
      } catch (error) {
        failures.push(`${team.abbreviation}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const logsStamped = await prisma.$executeRaw`
    UPDATE "NbaPlayerGameLog" AS l
    SET "positionGroup" = p."positionGroup"
    FROM "NbaPlayer" AS p
    WHERE l."nbaPlayerId" = p.id AND l."positionGroup" IS NULL AND p."positionGroup" IS NOT NULL`;

  return { missingBefore, playersUpdated, logsStamped, failures };
}
