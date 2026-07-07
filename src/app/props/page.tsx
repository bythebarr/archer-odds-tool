import Link from "next/link";
import { listMlbTeams, type MlbTeamSummary } from "@/lib/queries/games";
import { PropsSearchBox } from "@/components/PropsSearchBox";
import { TeamBadge } from "@/components/TeamBadge";

function groupByDivision(teams: MlbTeamSummary[]): Map<string, MlbTeamSummary[]> {
  const groups = new Map<string, MlbTeamSummary[]>();
  for (const team of teams) {
    // `division` is already the full name (e.g. "American League Central") —
    // MLB Stats API's division.name includes the league, not just the tier.
    const list = groups.get(team.division) ?? [];
    list.push(team);
    groups.set(team.division, list);
  }
  return groups;
}

export default async function PropsHubPage() {
  const teams = await listMlbTeams();
  const groups = groupByDivision(teams);

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <h1 className="text-xl font-semibold text-foreground">Player Props</h1>
      <p className="text-sm text-muted-foreground">
        Hit-rate history for MLB player props — research/discovery only, no bet placement or tracking.
      </p>

      <div className="mt-6">
        <PropsSearchBox />
      </div>

      {teams.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          No teams available right now.
        </p>
      ) : (
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {[...groups.entries()].map(([division, divisionTeams]) => (
          <div key={division}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {division}
            </h2>
            <ul className="mt-2 space-y-0.5">
              {divisionTeams.map((team) => (
                <li key={team.id}>
                  <Link
                    href={`/props/team/${team.id}`}
                    className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium text-foreground hover:bg-accent/50 hover:text-primary"
                  >
                    <TeamBadge abbreviation={team.abbreviation} name={team.name} size={26} />
                    {team.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
