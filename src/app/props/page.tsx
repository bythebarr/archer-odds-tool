import Link from "next/link";
import { getPropBoard, listPropSports } from "@/lib/props/board";
import { listMlbTeams, type MlbTeamSummary } from "@/lib/queries/games";
import { PropBoard } from "@/components/PropBoard";
import { PropsSearchBox } from "@/components/PropsSearchBox";
import { TeamBadge } from "@/components/TeamBadge";
import { PageShell, PageHeader } from "@/components/PageShell";
import { DateNav } from "@/components/DateNav";
import { todayEt, isValidEtDate } from "@/lib/dateEt";

// Rides the daily game-log sync, so it changes day to day — render per request.
export const dynamic = "force-dynamic";

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

/**
 * Player Props — the board IS the landing page. Search sits up top (fastest path
 * to any player) and a Board/Teams toggle swaps the ranked board for the
 * division-grouped team browser. No intermediate hub to click through.
 */
export default async function PropsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; stat?: string; tab?: string }>;
}) {
  const { date: dateParam, view, stat, tab } = await searchParams;
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && isValidEtDate(dateParam) ? dateParam : todayEt();
  const teamsView = tab === "teams";

  const segClass = (active: boolean) =>
    `rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
      active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <PageShell width="3xl">
      <PageHeader
        title="Player Props"
        right={<span className="text-xs text-muted-foreground">Hit-rate research</span>}
      />

      {/* Search — the fastest path to any single player */}
      <div className="mt-5">
        <PropsSearchBox />
      </div>

      {/* Board / Teams toggle — board is the default, teams one tap away */}
      <div className="mt-5 inline-flex rounded-lg bg-muted p-0.5">
        <Link href={`/props?date=${date}`} scroll={false} className={segClass(!teamsView)}>
          Board
        </Link>
        <Link href={`/props?date=${date}&tab=teams`} scroll={false} className={segClass(teamsView)}>
          Teams
        </Link>
      </div>

      {teamsView ? (
        <TeamsBrowser />
      ) : (
        <BoardView date={date} view={view} stat={stat} />
      )}
    </PageShell>
  );
}

async function BoardView({ date, view, stat }: { date: string; view?: string; stat?: string }) {
  // Only MLB has prop data today; the framework is sport-agnostic (other sports
  // register a config in board.ts and appear here with their own views/splits).
  const board = await getPropBoard("mlb", date, view, stat);
  const sports = listPropSports();

  // Carry the active view (not the stat — it resets per view) across day nav.
  const navSuffix = `&view=${board.activeView}`;

  return (
    <>
      {/* Sport selector — only worth showing once there's more than one sport
          to pick from; a single non-interactive "MLB" pill is just noise. */}
      {sports.length > 1 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {sports.map((s) => (
            <span
              key={s.sport}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
            >
              <span aria-hidden>{s.icon}</span>
              {s.label}
            </span>
          ))}
        </div>
      )}

      <DateNav basePath="/props" date={date} extraQuery={navSuffix} />

      <div className="mt-8">
        <PropBoard board={board} date={date} basePath="/props" />
      </div>
    </>
  );
}

async function TeamsBrowser() {
  const teams = await listMlbTeams();
  const groups = groupByDivision(teams);

  if (teams.length === 0) {
    return (
      <p className="mt-8 text-center text-sm text-muted-foreground">No teams available right now.</p>
    );
  }

  return (
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
                  <TeamBadge abbreviation={team.abbreviation} name={team.name} mlbTeamId={team.mlbTeamId} size={26} />
                  {team.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
