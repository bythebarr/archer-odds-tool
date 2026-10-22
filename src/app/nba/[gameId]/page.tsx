import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTeamGameWithLines } from "@/lib/queries/teamLeagueGames";
import Link from "next/link";
import { TeamLeagueGame } from "@/components/TeamLeagueGame";
import { etDateOf } from "@/lib/dateEt";

/** Shares getTeamGameWithLines's per-request cache() with the page below — same pattern as the MLB/tennis/soccer game pages. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ gameId: string }>;
}): Promise<Metadata> {
  const { gameId } = await params;
  const result = await getTeamGameWithLines("nba", gameId);
  if (!result) return {};

  const { game } = result;
  const title = `${game.awayTeam.name} at ${game.homeTeam.name}`;
  const description = `${title} — NBA spread, total, and moneyline line-shopping.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

export default async function NbaGamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const result = await getTeamGameWithLines("nba", gameId);
  if (!result) notFound();

  return (
    <TeamLeagueGame
      sport="nba"
      result={result}
      disclaimer="Line-shopping only — the best price per side among bettable books, compared at the consensus number. No model EV for NBA: no model here has been shown to beat a closing line."
      links={
        <Link
          href={`/nba/props?date=${etDateOf(result.game.scheduledStartUtc)}&game=${result.game.id}`}
          className="font-medium text-primary hover:underline"
        >
          Player props for this game →
        </Link>
      }
    />
  );
}
