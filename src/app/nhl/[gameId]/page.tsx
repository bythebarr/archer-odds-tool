import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTeamGameWithLines } from "@/lib/queries/teamLeagueGames";
import { TeamLeagueGame } from "@/components/TeamLeagueGame";

export async function generateMetadata({ params }: { params: Promise<{ gameId: string }> }): Promise<Metadata> {
  const { gameId } = await params;
  const result = await getTeamGameWithLines("nhl", gameId);
  if (!result) return {};
  const { game } = result;
  const title = `${game.awayTeam.name} at ${game.homeTeam.name}`;
  const description = `${title} — NHL puck line, total and moneyline odds from every sportsbook, side by side.`;
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

export default async function NhlGamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const result = await getTeamGameWithLines("nhl", gameId);
  if (!result) notFound();

  // Lines-only v1: no model panel, market board or props tab — those render
  // ARCHR's own numbers, and NHL has no ARCHR game model yet. TeamLeagueGame
  // renders the full per-book ladder natively when they're omitted.
  return (
    <TeamLeagueGame
      sport="nhl"
      result={result}
      disclaimer="The best price per side among bettable books at the consensus number. NHL carries no ARCHR line yet — these are the books' own odds, shopped across every book we track."
    />
  );
}
