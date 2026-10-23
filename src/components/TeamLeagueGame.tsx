import type { ReactNode } from "react";
import type { TeamGameWithLines } from "@/lib/queries/teamLeagueGames";
import type { TeamLeagueSport } from "@/lib/teamLeague/league";
import { TeamGameLinesView } from "@/components/TeamGameLinesView";
import { espnTeamLogoUrl } from "@/lib/logos";
import { TeamBadge } from "@/components/TeamBadge";
import { BackLink } from "@/components/BackLink";

/** One team-league game: matchup header plus the line-shopping view. Shared by /nfl/[gameId] and /nba/[gameId]. */
export function TeamLeagueGame({
  sport,
  result,
  disclaimer,
  links,
}: {
  sport: TeamLeagueSport;
  result: TeamGameWithLines;
  disclaimer: string;
  /** League-specific links under the header, e.g. NBA's props for this game. */
  links?: ReactNode;
}) {
  const { game, lines } = result;

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <BackLink fallbackHref={`/${sport}`} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
        ← Back
      </BackLink>

      <h1 className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-semibold text-foreground">
        <span className="inline-flex items-center gap-2">
          <TeamBadge abbreviation={game.awayTeam.abbreviation} name={game.awayTeam.name} logoUrl={espnTeamLogoUrl(sport, game.awayTeam.abbreviation)} size={24} />
          {game.awayTeam.name}
        </span>
        <span>at</span>
        <span className="inline-flex items-center gap-2">
          <TeamBadge abbreviation={game.homeTeam.abbreviation} name={game.homeTeam.name} logoUrl={espnTeamLogoUrl(sport, game.homeTeam.abbreviation)} size={24} />
          {game.homeTeam.name}
        </span>
      </h1>
      <p className="text-sm text-muted-foreground">
        {new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/New_York",
        }).format(game.scheduledStartUtc)}{" "}
        ET · {game.status}
      </p>
      {links && <div className="mt-2 text-sm">{links}</div>}

      <div className="mt-8">
        <TeamGameLinesView sport={sport} game={game} lines={lines} disclaimer={disclaimer} />
      </div>
    </div>
  );
}
