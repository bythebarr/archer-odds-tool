import type { TeamGameSummary, TeamGameWithLines } from "@/lib/queries/teamLeagueGames";
import type { GameLineRow } from "@/lib/queries/games";
import type { TeamLeagueSport } from "@/lib/teamLeague/league";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { bestLinesBySide } from "@/lib/odds/bestPrice";
import { TeamBadge } from "@/components/TeamBadge";
import { MatchCard, type MatchCardChip } from "@/components/MatchCard";

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
function signed(point: number): string {
  return point > 0 ? `+${point}` : `${point}`;
}

/**
 * Preview chips for one game: the best bettable spread per side, then the best
 * Over and Under. The spread leads because it's where both leagues' action is;
 * a game with no spread priced yet falls back to the moneyline rather than
 * rendering an empty card.
 *
 * Alt lines are excluded: they're a ladder of alternative numbers, and the best
 * price on some far-off alternate spread isn't comparable to the main one.
 */
function bestLinePreview(game: TeamGameSummary, lines: GameLineRow[]): MatchCardChip[] {
  const main = lines.filter((l) => !l.isAlternate);
  const abbr = (side: string) => (side === "home" ? game.homeTeam.abbreviation : game.awayTeam.abbreviation);

  const spreads = bestLinesBySide(main.filter((l) => l.marketType === "spreads"), ["away", "home"]);
  const sides: MatchCardChip[] = spreads.length
    ? spreads.map((line) => ({
        label: abbr(line.side),
        value:
          line.point === null
            ? formatAmerican(line.priceAmerican)
            : `${signed(line.point)} ${formatAmerican(line.priceAmerican)}`,
      }))
    : bestLinesBySide(main.filter((l) => l.marketType === "h2h"), ["away", "home"]).map((line) => ({
        label: abbr(line.side),
        value: formatAmerican(line.priceAmerican),
      }));

  const totals = bestLinesBySide(main.filter((l) => l.marketType === "totals"), ["over", "under"]).map(
    (line) => ({
      label: line.side === "over" ? "O" : "U",
      value: `${line.point ?? ""} ${formatAmerican(line.priceAmerican)}`.trim(),
    })
  );

  return [...sides, ...totals];
}

/** The list of upcoming games for a team league, each with its best-line preview. */
export function TeamLeagueBoard({ sport, games }: { sport: TeamLeagueSport; games: TeamGameWithLines[] }) {
  return (
    <div className="mt-6 flex flex-col gap-3">
      {games.map(({ game, lines }) => (
        <MatchCard
          key={game.id}
          href={`/${sport}/${game.id}`}
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
          chips={bestLinePreview(game, lines)}
        />
      ))}
    </div>
  );
}
