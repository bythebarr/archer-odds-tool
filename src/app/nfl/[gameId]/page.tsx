import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getNflGameWithLines } from "@/lib/queries/nflGames";
import { NflGameLinesView } from "@/components/NflGameLinesView";
import { TeamBadge } from "@/components/TeamBadge";
import { BackLink } from "@/components/BackLink";

/** Shares getNflGameWithLines's per-request cache() with the page below — same pattern as the MLB/tennis/soccer game pages. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ gameId: string }>;
}): Promise<Metadata> {
  const { gameId } = await params;
  const result = await getNflGameWithLines(gameId);
  if (!result) return {};

  const { game } = result;
  const title = `${game.awayTeam.name} at ${game.homeTeam.name}`;
  const description = `${title} — NFL spread, total, and moneyline line-shopping.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

export default async function NflGamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const result = await getNflGameWithLines(gameId);
  if (!result) notFound();

  const { game, lines } = result;

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <BackLink fallbackHref="/nfl" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
        ← Back
      </BackLink>

      <h1 className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-semibold text-foreground">
        <span className="inline-flex items-center gap-2">
          <TeamBadge abbreviation={game.awayTeam.abbreviation} name={game.awayTeam.name} size={24} />
          {game.awayTeam.name}
        </span>
        <span>at</span>
        <span className="inline-flex items-center gap-2">
          <TeamBadge abbreviation={game.homeTeam.abbreviation} name={game.homeTeam.name} size={24} />
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

      <div className="mt-8">
        <NflGameLinesView game={game} lines={lines} />
      </div>
    </div>
  );
}
