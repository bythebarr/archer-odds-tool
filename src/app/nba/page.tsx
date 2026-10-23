import type { Metadata } from "next";
import Link from "next/link";
import { listTeamLeagueGamesWithLines } from "@/lib/queries/teamLeagueGames";
import { TeamLeagueBoard } from "@/components/TeamLeagueBoard";
import { PageShell, PageHeader } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";
import { getFeedFreshness } from "@/lib/freshness";

// Same rationale as the tennis/soccer pages: odds update via cron, not deploys,
// so this must not be statically prerendered at build time.
export const metadata: Metadata = {
  title: "NBA — spread, total, and moneyline line-shopping",
  description:
    "NBA odds line-shopping — compare the best spread, total, and moneyline price across sportsbooks, game by game.",
};

export const dynamic = "force-dynamic";

export default async function NbaPage() {
  const [games, freshness] = await Promise.all([listTeamLeagueGamesWithLines("nba"), getFeedFreshness("nbaOdds")]);

  return (
    <PageShell width="2xl">
      <PageHeader
        title="NBA"
        description={
          <>
            Odds line-shopping — best spread, total, and moneyline across books.{" "}
            {/* Stated rather than implied: games are graded off ESPN's scoreboard,
                but no model has beaten a closing line, so nothing claims an edge. */}
            <span className="text-muted-foreground/80">Prices only — no model EV.</span>
          </>
        }
        right={
          <Link href="/nba/props" className="text-xs text-muted-foreground underline underline-offset-2">
            Player props →
          </Link>
        }
      />

      {games.length === 0 ? (
        <EmptyState title="No NBA games priced right now" freshness={freshness} arrow="miss" supportContext="nba-empty">
          Books hang NBA numbers a day or so before tip-off, and the night&apos;s
          card drops off once games start — check back ahead of the next slate.
        </EmptyState>
      ) : (
        <TeamLeagueBoard sport="nba" games={games} />
      )}
    </PageShell>
  );
}
