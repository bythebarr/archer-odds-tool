import Link from "next/link";
import type { GameSummary } from "@/lib/queries/games";
import type { RecentTeamPlayer } from "@/lib/queries/props";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TeamPlayerListProps {
  label: string;
  players: RecentTeamPlayer[];
  gameId: string;
  teamId: string;
}

function TeamPlayerList({ label, players, gameId, teamId }: TeamPlayerListProps) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{label}</h3>
      {players.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No recent game logs.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {players.map(({ player }) => (
            <li key={player.id}>
              <Link
                href={`/props/${player.id}?vsGame=${gameId}&team=${teamId}`}
                className="block py-1.5 text-sm text-foreground hover:text-primary hover:underline"
              >
                {player.fullName}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface PlayerPropsSectionProps {
  game: GameSummary;
  homePlayers: RecentTeamPlayer[];
  awayPlayers: RecentTeamPlayer[];
}

/**
 * Each team's most-recently-active players (not an official lineup — batters
 * aren't tracked as probable starters the way pitchers are, see
 * MlbPlayer's schema docstring) linking into the player prop hit-rate page,
 * carrying vsGame/team so that page can highlight the split matching this
 * game's actual opposing probable starter.
 */
export function PlayerPropsSection({ game, homePlayers, awayPlayers }: PlayerPropsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Player Props
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <TeamPlayerList
            label={game.awayTeam.abbreviation}
            players={awayPlayers}
            gameId={game.id}
            teamId={game.awayTeam.id}
          />
          <TeamPlayerList
            label={game.homeTeam.abbreviation}
            players={homePlayers}
            gameId={game.id}
            teamId={game.homeTeam.id}
          />
        </div>
      </CardContent>
    </Card>
  );
}
