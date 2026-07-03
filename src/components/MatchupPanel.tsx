import type { GameSummary } from "@/lib/queries/games";
import type { GameMatchup, PitcherInfo } from "@/lib/queries/matchup";
import type { ArcherWinProbability } from "@/lib/archer/winProbability";
import type { ConsensusFairProbability } from "@/lib/odds/devig";
import { formatRecordSplit, formatEra } from "@/lib/odds/format";
import { TeamBadge } from "./TeamBadge";

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

function formatProb(p: number | null): string {
  return p !== null ? `${(p * 100).toFixed(0)}%` : "—";
}

interface ProbabilityRowProps {
  label: string;
  archer: number | null;
  market: number | null;
}

/** One team's Archer probability vs. the market's own de-vigged implied probability, plus the edge between them. */
function ProbabilityRow({ label, archer, market }: ProbabilityRowProps) {
  const edge = archer !== null && market !== null ? archer - market : null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="flex items-center gap-3">
        <span className="text-zinc-900 dark:text-zinc-50">{formatProb(archer)}</span>
        <span className="text-zinc-400">vs {formatProb(market)}</span>
        {edge !== null && (
          <span
            className={
              edge >= 0
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }
          >
            {edge >= 0 ? "+" : ""}
            {(edge * 100).toFixed(1)}pt
          </span>
        )}
      </span>
    </div>
  );
}

interface MatchupPanelProps {
  game: GameSummary;
  matchup: GameMatchup;
  archerProb: ArcherWinProbability;
  marketProb: ConsensusFairProbability;
}

/**
 * The user's own manual handicapping comparison ("the Archer method"):
 * probable starters' record/ERA, plus each team's home/away and recent-form
 * records — surfaced side by side, and also reduced to a single Archer win
 * probability (see winProbability.ts) shown against the market's own
 * de-vigged implied probability below.
 */
export function MatchupPanel({ game, matchup, archerProb, marketProb }: MatchupPanelProps) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Matchup</h2>
      <div className="mt-3 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            <TeamBadge abbreviation={game.awayTeam.abbreviation} name={game.awayTeam.name} />
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
            <TeamBadge abbreviation={game.homeTeam.abbreviation} name={game.homeTeam.name} />
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

      {(archerProb.homeProb !== null || marketProb.fairProbA !== null) && (
        <div className="mt-4 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Archer win probability vs. market
          </h3>
          <div className="mt-2 space-y-1">
            <ProbabilityRow
              label={`${game.awayTeam.abbreviation} to win`}
              archer={archerProb.awayProb}
              market={marketProb.fairProbB}
            />
            <ProbabilityRow
              label={`${game.homeTeam.abbreviation} to win`}
              archer={archerProb.homeProb}
              market={marketProb.fairProbA}
            />
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-zinc-400">
        Archer probability is a v1 heuristic from pitcher ERA + recent form only — directional, not
        a rigorous projection. It powers the Archer EV column on the Moneyline tab below; spread/
        total EV still comes only from market consensus and historical hit-rate.
      </p>
    </div>
  );
}
