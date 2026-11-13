import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTeamGameWithLines } from "@/lib/queries/teamLeagueGames";
import { getNbaPropsSlate, toWireSlate } from "@/lib/queries/nbaProps";
import { readPropsPrefs } from "@/lib/nba/propsPrefs";
import { etDateOf } from "@/lib/dateEt";
import { TeamLeagueGame } from "@/components/TeamLeagueGame";
import { TeamBreakdown, TeamFaceOff } from "@/components/matchup/TeamGameBreakdown";
import { getGameModelView } from "@/lib/queries/gameModel";
import { getGameOffers } from "@/lib/queries/gameMarkets";
import { GameMarketBoard } from "@/components/game/GameMarketBoard";
import { espnTeamLogoUrl } from "@/lib/logos";
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
      <NbaPropsFinder slate={toWireSlate(slate)} initial={prefs} initialGame={gameId} lockGame />
    ) : (
      <p className="mt-8 text-center text-sm text-muted-foreground">
        No player props posted for this game yet. Books usually post them the morning of the game.
      </p>
    );
  }

  const modelView = await getGameModelView("nba", gameId, result.lines);
  const offers = tab === "lines" ? await getGameOffers("nba", gameId, result.lines, modelView) : [];
  const team = (t: { name: string; abbreviation: string }) => ({ name: t.name, abbreviation: t.abbreviation, logoUrl: espnTeamLogoUrl("nba", t.abbreviation) });

  return (
    <TeamLeagueGame
      hero={modelView ? <TeamFaceOff sport="nba" view={modelView} when={whenLabel(result.game.scheduledStartUtc)} /> : undefined}
      modelPanel={modelView ? <TeamBreakdown sport="nba" view={modelView} /> : null}
      marketBoard={
        offers.length > 0 ? (
          <GameMarketBoard offers={offers} teams={{ home: team(result.game.homeTeam), away: team(result.game.awayTeam) }} sport="nba" matchId={gameId} />
        ) : undefined
      }
      sport="nba"
      result={result}
      tab={tab}
      propsHref={`/nba/${gameId}?tab=props`}
      propsPanel={propsPanel}
      disclaimer="The best price per side among bettable books at the consensus number, with a +EV tag where a price beats the market's fair price. The ARCHR line above blends the game model with that market."
    />
  );
}

/** "Mon, Oct 27 · 7:00 PM ET" for the face-off. */
function whenLabel(d: Date): string {
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(d);
  return `${day} · ${time} ET`;
}
