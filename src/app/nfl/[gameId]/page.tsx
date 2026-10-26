import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTeamGameWithLines } from "@/lib/queries/teamLeagueGames";
import { TeamLeagueGame } from "@/components/TeamLeagueGame";
import { getNflPropsSlate } from "@/lib/queries/nflProps";
import { NflPropsFinder } from "@/components/nfl/NflPropsFinder";

/** Shares getTeamGameWithLines's per-request cache() with the page below — same pattern as the MLB/tennis/soccer game pages. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ gameId: string }>;
}): Promise<Metadata> {
  const { gameId } = await params;
  const result = await getTeamGameWithLines("nfl", gameId);
  if (!result) return {};

  const { game } = result;
  const title = `${game.awayTeam.name} at ${game.homeTeam.name}`;
  const description = `${title} — NFL spread, total, moneyline and player props across sportsbooks.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

export default async function NflGamePage({
  params,
  searchParams,
}: {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { gameId } = await params;
  const { tab: tabParam } = await searchParams;
  const result = await getTeamGameWithLines("nfl", gameId);
  if (!result) notFound();

  const tab = tabParam === "props" ? "props" : "lines";
  let propsPanel = null;
  if (tab === "props") {
    const slate = await getNflPropsSlate();
    propsPanel = slate.props.some((p) => slate.players[p.playerId]?.gameId === gameId) ? (
      <NflPropsFinder slate={slate} initialGame={gameId} lockGame />
    ) : (
      <p className="mt-8 text-center text-sm text-muted-foreground">
        No player props posted for this game yet. Books usually post them a few days before kickoff.
      </p>
    );
  }

  return (
    <TeamLeagueGame
      sport="nfl"
      result={result}
      tab={tab}
      propsHref={`/nfl/${gameId}?tab=props`}
      propsPanel={propsPanel}
      disclaimer="Game lines are line-shopping: the best price per side among bettable books at the consensus number, with a +EV tag where a price beats the market's fair price. ARCHR's projection model prices the player props."
    />
  );
}
