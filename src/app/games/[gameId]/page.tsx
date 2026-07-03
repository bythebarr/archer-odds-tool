import Link from "next/link";
import { notFound } from "next/navigation";
import { getGameWithLines } from "@/lib/queries/games";
import { getTeamHitRates } from "@/lib/queries/hitRate";
import { teamLogoSources } from "@/lib/logos";
import { TEAM_COLORS } from "@/lib/teamColors";
import { GameLinesView } from "@/components/GameLinesView";
import { Logo } from "@/components/Logo";

export default async function GamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const result = await getGameWithLines(gameId);
  if (!result) notFound();

  const { game, lines } = result;
  const [homeHitRates, awayHitRates] = await Promise.all([
    getTeamHitRates(game.homeTeam.id),
    getTeamHitRates(game.awayTeam.id),
  ]);

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← Today&apos;s games
      </Link>

      <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        <Logo
          sources={teamLogoSources(game.awayTeam.abbreviation)}
          alt={game.awayTeam.name}
          fallbackText={game.awayTeam.abbreviation}
          color={TEAM_COLORS[game.awayTeam.abbreviation]}
          size={24}
        />
        {game.awayTeam.name} @ {game.homeTeam.name}
        <Logo
          sources={teamLogoSources(game.homeTeam.abbreviation)}
          alt={game.homeTeam.name}
          fallbackText={game.homeTeam.abbreviation}
          color={TEAM_COLORS[game.homeTeam.abbreviation]}
          size={24}
        />
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
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

      <div className="mt-8">
        <GameLinesView
          game={game}
          lines={lines}
          homeHitRates={homeHitRates}
          awayHitRates={awayHitRates}
        />
      </div>
    </div>
  );
}
