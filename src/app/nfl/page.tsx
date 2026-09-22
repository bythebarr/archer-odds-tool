import type { Metadata } from "next";
import Link from "next/link";
import { listNflGamesWithLines } from "@/lib/queries/nflGames";
import type { NflGameSummary } from "@/lib/queries/nflGames";
import type { GameLineRow } from "@/lib/queries/games";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { bestLinesBySide } from "@/lib/odds/bestPrice";
import { TeamBadge } from "@/components/TeamBadge";
import { MatchCard, type MatchCardChip } from "@/components/MatchCard";
import { PageShell, PageHeader } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";
import { getFeedFreshness } from "@/lib/freshness";

// Same rationale as the tennis/soccer pages: odds update via cron, not deploys,
// so this must not be statically prerendered at build time.
export const metadata: Metadata = {
  title: "NFL — spread, total, and moneyline line-shopping",
  description:
    "NFL odds line-shopping — compare the best spread, total, and moneyline price across sportsbooks, game by game.",
};

export const dynamic = "force-dynamic";

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(date);
}

/** "-3.5" / "+3.5" — a spread reads wrong without its explicit sign. */
function formatPoint(point: number): string {
  return point > 0 ? `+${point}` : `${point}`;
}

/**
 * Preview chips for one game. NFL's spine is the spread, so that leads — but a
 * game with no spread priced yet (or a book set that only hung a moneyline)
 * falls back to h2h rather than rendering an empty card.
 *
 * Alt lines are excluded: they're a ladder of alternative numbers, and the best
 * price on some far-off alternate spread isn't comparable to the main one.
 */
function bestPricePreview(game: NflGameSummary, lines: GameLineRow[]): MatchCardChip[] {
  const main = lines.filter((l) => !l.isAlternate);
  const abbr = (side: string) => (side === "home" ? game.homeTeam.abbreviation : game.awayTeam.abbreviation);

  const spreads = bestLinesBySide(main.filter((l) => l.marketType === "spreads"), ["away", "home"]);
  if (spreads.length) {
    return spreads.map((line) => ({
      label: abbr(line.side),
      value:
        line.point === null
          ? formatAmerican(line.priceAmerican)
          : `${formatPoint(line.point)} ${formatAmerican(line.priceAmerican)}`,
    }));
  }

  return bestLinesBySide(main.filter((l) => l.marketType === "h2h"), ["away", "home"]).map((line) => ({
    label: abbr(line.side),
    value: formatAmerican(line.priceAmerican),
  }));
}

export default async function NflPage() {
  const [games, freshness] = await Promise.all([listNflGamesWithLines(), getFeedFreshness("nflOdds")]);

  return (
    <PageShell width="2xl">
      <PageHeader
        title="NFL"
        description={
          <>
            Odds line-shopping — best spread, total, and moneyline across books.{" "}
            {/* Stated rather than implied by a blank record: NFL has the provider's
                best odds coverage but no results feed yet, so nothing here grades.
                See SportMeta.signalOnly and docs/architecture/nfl-adapter.md. */}
            <span className="text-muted-foreground/80">
              Prices only — no model EV, and no results feed yet, so these aren&apos;t
              graded or counted in the tracked record.
            </span>
          </>
        }
        right={
          <Link href="/nfl/research" className="text-xs text-muted-foreground underline underline-offset-2">
            Experimental research →
          </Link>
        }
      />

      {games.length === 0 ? (
        <EmptyState title="No NFL games priced right now" freshness={freshness} arrow="miss" supportContext="nfl-empty">
          Books hang NFL numbers as the week&apos;s slate approaches — in the deep
          off-season there&apos;s nothing to shop.
        </EmptyState>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {games.map(({ game, lines }) => (
            <MatchCard
              key={game.id}
              href={`/nfl/${game.id}`}
              competitors={[
                {
                  badge: <TeamBadge abbreviation={game.awayTeam.abbreviation} name={game.awayTeam.name} size={28} />,
                  label: game.awayTeam.name,
                },
                {
                  badge: <TeamBadge abbreviation={game.homeTeam.abbreviation} name={game.homeTeam.name} size={28} />,
                  label: game.homeTeam.name,
                },
              ]}
              timeLabel={`${formatTime(game.scheduledStartUtc)} ET`}
              status={game.status}
              isLive={game.status === "live"}
              chips={bestPricePreview(game, lines)}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}
