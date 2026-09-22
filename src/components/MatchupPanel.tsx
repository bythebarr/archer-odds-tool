import type { GameSummary } from "@/lib/queries/games";
import type { GameMatchup, PitcherInfo } from "@/lib/queries/matchup";
import type { ArcherWinProbability } from "@/lib/archer/winProbability";
import type { ExpectedRuns } from "@/lib/archer/expectedRuns";
import type { ConsensusFairProbability } from "@/lib/odds/devig";
import { formatRecordSplit, formatEra } from "@/lib/odds/format";
import { TeamBadge } from "./TeamBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function PitcherLine({ pitcher }: { pitcher: PitcherInfo | null }) {
  if (!pitcher) {
    return <p className="text-sm text-muted-foreground">Probable starter TBD</p>;
  }
  return (
    <p className="text-sm text-foreground">
      {pitcher.fullName}
      <span className="ml-1.5 text-xs text-muted-foreground">
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
    <div className="flex justify-between text-xs text-muted-foreground">
      <span>{label}</span>
      <span className="text-foreground/80">{value}</span>
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
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-3">
        <span className="text-foreground">{formatProb(archer)}</span>
        <span className="text-muted-foreground">vs {formatProb(market)}</span>
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
  archerRuns: ExpectedRuns;
  marketProb: ConsensusFairProbability;
}

function formatRuns(runs: number | null): string {
  return runs !== null ? runs.toFixed(1) : "—";
}

/** Signed one-decimal formatter for shift/edge driver values — same shape as CFB's own `pts()` helper (CfbGameCard.tsx), reused here for visual consistency across sports. */
function pts(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/** A [0,1] score centered on 0.5 (teamFormScore/pitcherQualityScore), read as a signed point edge off that midpoint. Null when the underlying data isn't available yet. */
function scoreEdge(score: number | null): string {
  return score !== null ? pts((score - 0.5) * 100) : "—";
}

/**
 * The user's own manual handicapping comparison ("the Archer method"):
 * probable starters' record/ERA, plus each team's home/away and recent-form
 * records — surfaced side by side, and also reduced to a single Archer win
 * probability (see winProbability.ts) shown against the market's own
 * de-vigged implied probability below.
 */
export function MatchupPanel({ game, matchup, archerProb, archerRuns, marketProb }: MatchupPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Matchup
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <TeamBadge abbreviation={game.awayTeam.abbreviation} name={game.awayTeam.name} mlbTeamId={game.awayTeam.mlbTeamId} />
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
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <TeamBadge abbreviation={game.homeTeam.abbreviation} name={game.homeTeam.name} mlbTeamId={game.homeTeam.mlbTeamId} />
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
          <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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

        {(archerRuns.home !== null || archerRuns.away !== null) && (
          <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Archer projected runs
            </h3>
            <div className="mt-2 space-y-1">
              <StatRow label={`${game.awayTeam.abbreviation} projected runs`} value={formatRuns(archerRuns.away)} />
              <StatRow label={`${game.homeTeam.abbreviation} projected runs`} value={formatRuns(archerRuns.home)} />
              <StatRow
                label="Projected total"
                value={
                  archerRuns.home !== null && archerRuns.away !== null
                    ? formatRuns(archerRuns.home + archerRuns.away)
                    : "—"
                }
              />
            </div>
          </div>
        )}

        <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What&apos;s driving this</h3>
          <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <div className="space-y-1">
              <StatRow label="Weighted offense rate" value={formatRuns(archerRuns.drivers.away.offenseRuns)} />
              <StatRow label="Opp. bullpen quality (runs/9)" value={formatRuns(archerRuns.drivers.away.opponentBullpenRunRate)} />
              <StatRow label="Opp. pitcher runs contribution" value={formatRuns(archerRuns.drivers.away.opponentPitcherRuns)} />
              <StatRow label="Platoon shift" value={pts(archerRuns.drivers.away.platoonShift)} />
              <StatRow label="Form edge" value={scoreEdge(archerProb.drivers.away.formScore)} />
              <StatRow label="Pitcher-quality edge" value={scoreEdge(archerProb.drivers.away.pitcherQualityScore)} />
            </div>
            <div className="space-y-1">
              <StatRow label="Weighted offense rate" value={formatRuns(archerRuns.drivers.home.offenseRuns)} />
              <StatRow label="Opp. bullpen quality (runs/9)" value={formatRuns(archerRuns.drivers.home.opponentBullpenRunRate)} />
              <StatRow label="Opp. pitcher runs contribution" value={formatRuns(archerRuns.drivers.home.opponentPitcherRuns)} />
              <StatRow label="Platoon shift" value={pts(archerRuns.drivers.home.platoonShift)} />
              <StatRow label="Form edge" value={scoreEdge(archerProb.drivers.home.formScore)} />
              <StatRow label="Pitcher-quality edge" value={scoreEdge(archerProb.drivers.home.pitcherQualityScore)} />
            </div>
          </div>
          <div className="mt-2 border-t border-border/60 pt-2">
            <StatRow label="Weather shift (shared, both teams)" value={pts(archerRuns.drivers.home.weatherShift)} />
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          ARCHR Edge probability/runs are a v1 heuristic from pitcher ERA, recent form, opposing bullpen quality,
          starter platoon splits, and park weather — directional, not a rigorous projection. They power the ARCHR
          Edge column on every tab below (win probability for Moneyline, expected-runs-derived cover probability
          for Spread/Total).
        </p>
      </CardContent>
    </Card>
  );
}
