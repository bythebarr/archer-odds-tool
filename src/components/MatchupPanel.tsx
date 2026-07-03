import type { GameSummary } from "@/lib/queries/games";
import type { GameMatchup, PitcherInfo } from "@/lib/queries/matchup";
import { formatRecordSplit, formatEra } from "@/lib/odds/format";
import { teamLogoSources } from "@/lib/logos";
import { TEAM_COLORS } from "@/lib/teamColors";
import { Logo } from "./Logo";

function PitcherLine({ pitcher }: { pitcher: PitcherInfo | null }) {
  if (!pitcher) {
    return <p className="text-sm text-zinc-400">Probable starter TBD</p>;
  }
  return (
    <p className="text-sm text-zinc-900 dark:text-zinc-50">
      {pitcher.fullName}
      <span className="ml-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        {pitcher.wins}-{pitcher.losses}, {formatEra(pitcher.era)} ERA
      </span>
    </p>
  );
}

interface StatRowProps {
  label: string;
  value: string;
}

function StatRow({ label, value }: StatRowProps) {
  return (
    <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
      <span>{label}</span>
      <span className="text-zinc-700 dark:text-zinc-300">{value}</span>
    </div>
  );
}

interface MatchupPanelProps {
  game: GameSummary;
  matchup: GameMatchup;
}

/**
 * The user's own manual handicapping comparison ("the Archer method"):
 * probable starters' record/ERA, plus each team's home/away and recent-form
 * records — surfaced side by side for the user to read, not blended into
 * the Mkt/Hist EV numbers below (that's a separate, unbuilt modeling step).
 */
export function MatchupPanel({ game, matchup }: MatchupPanelProps) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Matchup</h2>
      <div className="mt-3 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            <Logo
              sources={teamLogoSources(game.awayTeam.abbreviation)}
              alt={game.awayTeam.name}
              fallbackText={game.awayTeam.abbreviation}
              color={TEAM_COLORS[game.awayTeam.abbreviation]}
            />
            {game.awayTeam.abbreviation}
          </h3>
          <div className="mt-2 space-y-2">
            <PitcherLine pitcher={matchup.awayPitcher} />
            <div className="space-y-1">
              <StatRow label="Away record" value={formatRecordSplit(matchup.awayForm.awayRecord)} />
              <StatRow label="Last 10" value={formatRecordSplit(matchup.awayForm.last10, 10)} />
              <StatRow label="Last 5" value={formatRecordSplit(matchup.awayForm.last5, 5)} />
            </div>
          </div>
        </div>

        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            <Logo
              sources={teamLogoSources(game.homeTeam.abbreviation)}
              alt={game.homeTeam.name}
              fallbackText={game.homeTeam.abbreviation}
              color={TEAM_COLORS[game.homeTeam.abbreviation]}
            />
            {game.homeTeam.abbreviation}
          </h3>
          <div className="mt-2 space-y-2">
            <PitcherLine pitcher={matchup.homePitcher} />
            <div className="space-y-1">
              <StatRow label="Home record" value={formatRecordSplit(matchup.homeForm.homeRecord)} />
              <StatRow label="Last 10" value={formatRecordSplit(matchup.homeForm.last10, 10)} />
              <StatRow label="Last 5" value={formatRecordSplit(matchup.homeForm.last5, 5)} />
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-zinc-400">
        Matchup context only — not factored into the Mkt/Hist EV numbers below.
      </p>
    </div>
  );
}
