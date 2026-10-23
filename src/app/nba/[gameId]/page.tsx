import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTeamGameWithLines } from "@/lib/queries/teamLeagueGames";
import { getNbaPropsSlate } from "@/lib/queries/nbaProps";
import { readPropsPrefs } from "@/lib/nba/propsPrefs";
import { etDateOf } from "@/lib/dateEt";
import { TeamLeagueGame } from "@/components/TeamLeagueGame";
import { NbaPropsFinder } from "@/components/nba/NbaPropsFinder";

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
  const description = `${title} — NBA spread, total, moneyline and player props across sportsbooks.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

export default async function NbaGamePage({
  params,
  searchParams,
}: {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{ tab?: string; stat?: string; side?: string; sort?: string }>;
}) {
  const { gameId } = await params;
  const query = await searchParams;
  const result = await getTeamGameWithLines("nba", gameId);
  if (!result) notFound();

  const tab = query.tab === "props" ? "props" : "lines";
  let propsPanel = null;
  if (tab === "props") {
    const [slate, prefs] = await Promise.all([
      getNbaPropsSlate(etDateOf(result.game.scheduledStartUtc)),
      readPropsPrefs(query),
    ]);
    propsPanel = slate.props.some((p) => slate.players[p.playerId]?.gameId === gameId) ? (
      <NbaPropsFinder slate={slate} initial={prefs} initialGame={gameId} lockGame />
    ) : (
      <p className="mt-8 text-center text-sm text-muted-foreground">
        No player props posted for this game yet. Books usually post them the morning of the game.
      </p>
    );
  }

  return (
    <TeamLeagueGame
      sport="nba"
      result={result}
      tab={tab}
      propsHref={`/nba/${gameId}?tab=props`}
      propsPanel={propsPanel}
      disclaimer="Line-shopping only — the best price per side among bettable books, compared at the consensus number. No model EV for NBA: no model here has been shown to beat a closing line."
    />
  );
}
