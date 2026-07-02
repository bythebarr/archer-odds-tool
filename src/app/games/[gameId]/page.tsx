import Link from "next/link";
import { notFound } from "next/navigation";
import { getGameWithLines } from "@/lib/queries/games";
import { GameLinesView } from "@/components/GameLinesView";

export default async function GamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const result = await getGameWithLines(gameId);
  if (!result) notFound();

  const { game, lines } = result;

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← Today&apos;s games
      </Link>

      <h1 className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        {game.awayTeam.name} @ {game.homeTeam.name}
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
        <GameLinesView game={game} lines={lines} />
      </div>
    </div>
  );
}
