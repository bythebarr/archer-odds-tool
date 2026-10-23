import type { ReactNode } from "react";
import type { TeamGameWithLines, TeamSummary } from "@/lib/queries/teamLeagueGames";
import type { TeamLeagueSport } from "@/lib/teamLeague/league";
import { TeamGameLinesView } from "@/components/TeamGameLinesView";
import { espnTeamLogoUrl } from "@/lib/logos";
import { Logo } from "@/components/Logo";
import { BackLink } from "@/components/BackLink";
import { SportTabs } from "@/components/book/SportTabs";

function TeamHero({ sport, team, side }: { sport: TeamLeagueSport; team: TeamSummary; side: "Away" | "Home" }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      <Logo sources={[espnTeamLogoUrl(sport, team.abbreviation)]} alt={team.name} fallbackText={team.abbreviation} size={60} />
      <div className="min-w-0">
        <p className="truncate text-base font-bold leading-tight text-foreground">{team.name}</p>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{side}</p>
      </div>
    </div>
  );
}

/**
 * One team-league game, sportsbook-style: a matchup header, then section tabs —
 * Game Lines (every book's price on the spread, total and moneyline) and, where
 * the league has them, Player Props. Shared by /nfl/[gameId] and /nba/[gameId].
 */
export function TeamLeagueGame({
  sport,
  result,
  disclaimer,
  tab = "lines",
  propsHref,
  propsPanel,
}: {
  sport: TeamLeagueSport;
  result: TeamGameWithLines;
  disclaimer: string;
  tab?: "lines" | "props";
  /** Link to this game's props tab; omitted for leagues without a props product. */
  propsHref?: string;
  propsPanel?: ReactNode;
}) {
  const { game, lines } = result;
  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(game.scheduledStartUtc);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(
    game.scheduledStartUtc
  );
  const linesHref = `/${sport}/${game.id}`;

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-10 pt-5 font-sans">
      <BackLink fallbackHref={`/${sport}`} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
        ← {sport.toUpperCase()}
      </BackLink>

      <div className="mt-3 rounded-2xl border border-border bg-card px-4 py-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <TeamHero sport={sport} team={game.awayTeam} side="Away" />
          <div className="flex flex-col items-center text-center">
            {game.status === "live" ? (
              <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Live</span>
            ) : (
              <>
                <span className="text-sm font-bold text-foreground">{time}</span>
                <span className="text-[11px] text-muted-foreground">{when}</span>
              </>
            )}
            <span className="mt-1 text-xs font-semibold text-muted-foreground">@</span>
          </div>
          <TeamHero sport={sport} team={game.homeTeam} side="Home" />
        </div>
      </div>

      <div className="mt-4">
        <SportTabs
          tabs={[
            { label: "Game Lines", href: linesHref, active: tab === "lines" },
            ...(propsHref ? [{ label: "Player Props", href: propsHref, active: tab === "props" }] : []),
          ]}
        />
      </div>

      {tab === "props" && propsPanel ? (
        propsPanel
      ) : (
        <div className="mt-2">
          <TeamGameLinesView sport={sport} game={game} lines={lines} disclaimer={disclaimer} />
        </div>
      )}
    </div>
  );
}
