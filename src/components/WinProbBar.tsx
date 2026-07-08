import { TEAM_COLORS } from "@/lib/teamColors";

interface WinProbBarProps {
  awayAbbr: string;
  homeAbbr: string;
  /** Archer model win probabilities in [0,1]; the bar splits by these. */
  awayProb: number;
  homeProb: number;
}

const FALLBACK_AWAY = "#64748b"; // slate — neutral when a team has no brand color
const FALLBACK_HOME = "#2563eb"; // primary blue

/**
 * ESPN-style win-probability "faceoff" bar: a single track split by the
 * Archer model's win probability, each side filled with that team's brand
 * color. Purely presentational (server-safe) — the numbers come from
 * computeArcherWinProbability upstream.
 */
export function WinProbBar({ awayAbbr, homeAbbr, awayProb, homeProb }: WinProbBarProps) {
  const total = awayProb + homeProb || 1;
  const awayPct = Math.round((awayProb / total) * 100);
  const homePct = 100 - awayPct;
  const awayColor = TEAM_COLORS[awayAbbr] ?? FALLBACK_AWAY;
  const homeColor = TEAM_COLORS[homeAbbr] ?? FALLBACK_HOME;

  return (
    <div>
      <p className="mb-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Archer win probability
      </p>
      <div className="flex items-center gap-2">
        <span className="w-11 shrink-0 font-mono text-sm font-bold tabular-nums text-foreground">{awayPct}%</span>
        <div className="flex h-2.5 flex-1 overflow-hidden rounded-full ring-1 ring-inset ring-foreground/10">
          <div style={{ width: `${awayPct}%`, backgroundColor: awayColor }} />
          <div style={{ width: `${homePct}%`, backgroundColor: homeColor }} />
        </div>
        <span className="w-11 shrink-0 text-right font-mono text-sm font-bold tabular-nums text-foreground">{homePct}%</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
        <span>{awayAbbr}</span>
        <span>{homeAbbr}</span>
      </div>
    </div>
  );
}
