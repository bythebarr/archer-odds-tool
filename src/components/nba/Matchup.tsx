import { matchupGrade, ordinal, paceRank, statMatchup, type DefenseTable, type MatchupGrade } from "@/lib/nba/matchup";
import type { NbaPropStatDef } from "@/lib/nba/propStats";
import type { PropSplit } from "@/lib/nba/propsMath";
import type { SlatePlayer } from "@/lib/queries/nbaProps";
import type { PropDirection } from "@/lib/props/tally";
import { Logo } from "@/components/Logo";
import { POSITION_GROUP_LABEL, type PositionGroup } from "@/lib/nba/positionGroups";
import { formatRate, rateTone } from "./HitMeter";

const GRADE: Record<MatchupGrade, { label: string; text: string; bg: string }> = {
  great: { label: "Great", text: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-500/15" },
  good: { label: "Good", text: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-500/10" },
  neutral: { label: "Neutral", text: "text-muted-foreground", bg: "bg-muted" },
  tough: { label: "Tough", text: "text-red-700 dark:text-red-300", bg: "bg-red-500/10" },
  bad: { label: "Bad", text: "text-red-700 dark:text-red-300", bg: "bg-red-500/15" },
};

/** Compact "DEF 27th" read for a prop card, toned for the chosen side. */
export function MatchupChip({
  defense,
  opponent,
  stat,
  side,
  group,
}: {
  defense: DefenseTable;
  opponent: string | undefined;
  stat: NbaPropStatDef;
  side: PropDirection;
  group: PositionGroup | null;
}) {
  const m = opponent ? statMatchup(defense, opponent, stat, group) : null;
  if (!m) return null;
  const g = GRADE[matchupGrade(m.rank, m.of, side)];
  const vs = m.scope === "position" && group ? ` to ${POSITION_GROUP_LABEL[group]}` : "";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 ${g.bg}`}
      title={`${opponent} allows ${m.perGame.toFixed(1)} ${stat.shortLabel} per game${vs}`}
    >
      <span className="text-[10px] font-semibold uppercase text-muted-foreground">
        {m.scope === "position" && group ? `Def v ${group}` : "Def"}
      </span>
      <span className={`font-mono font-semibold ${g.text}`}>{ordinal(m.rank)}</span>
    </span>
  );
}

function SplitTile({ split }: { split: PropSplit }) {
  return (
    <div className="rounded-lg bg-muted/60 px-1.5 py-2 text-center">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{split.label}</p>
      <p className={`font-mono text-base font-semibold leading-tight ${rateTone(split.rate)}`}>{formatRate(split.rate)}</p>
      <p className="text-[10px] text-muted-foreground">
        {split.rate.sampleSize ? `${split.rate.hits}/${split.rate.sampleSize}` : "—"}
        {split.avg !== null && <span className="ml-1 font-mono text-foreground/70">{split.avg.toFixed(1)}</span>}
      </p>
    </div>
  );
}

/** Every window as a tile: recent form on one row, season and situational splits below. */
export function SplitGrid({ splits }: { splits: PropSplit[] }) {
  const recent = splits.filter((s) => ["l3", "l5", "l10", "l15", "l20"].includes(s.key));
  const situational = splits.filter((s) => !["l3", "l5", "l10", "l15", "l20"].includes(s.key));
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-5 gap-1.5">
        {recent.map((s) => (
          <SplitTile key={s.key} split={s} />
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {situational.map((s) => (
          <SplitTile key={s.key} split={s} />
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">Hit rate · hits/games · average</p>
    </div>
  );
}

/** Where a rank sits across the league, as a track with a marker. Left = gives up the most. */
function RankTrack({ rank, of, grade }: { rank: number; of: number; grade: MatchupGrade }) {
  const pct = ((rank - 1) / Math.max(of - 1, 1)) * 100;
  const dot = grade === "great" || grade === "good" ? "bg-emerald-500" : grade === "neutral" ? "bg-foreground" : "bg-red-500";
  return (
    <div className="relative mt-1.5 h-1.5 rounded-full bg-muted" aria-hidden>
      <span className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background ${dot}`} style={{ left: `${pct}%` }} />
    </div>
  );
}

function Metric({ label, value, sub, children }: { label: string; value: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-right">
          <span className="font-mono text-sm font-semibold text-foreground">{value}</span>
          {sub && <span className="ml-1.5 text-[11px] text-muted-foreground">{sub}</span>}
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * The matchup read for one prop: what tonight's opponent gives up in the stat,
 * how fast its games run, the player's minutes trend, and his history against it.
 */
export function MatchupPanel({
  defense,
  player,
  stat,
  side,
  h2h,
  minutesL5,
  minutesSeason,
}: {
  defense: DefenseTable;
  player: SlatePlayer;
  stat: NbaPropStatDef;
  side: PropDirection;
  h2h: PropSplit | undefined;
  minutesL5: number | null;
  minutesSeason: number | null;
}) {
  const opp = player.opponent;
  const group = player.positionGroup;
  const m = opp ? statMatchup(defense, opp.abbreviation, stat, group) : null;
  const byPosition = m?.scope === "position" && group;
  const pace = opp ? paceRank(defense, opp.abbreviation) : null;
  const grade = m ? matchupGrade(m.rank, m.of, side) : null;
  const minutesDelta = minutesL5 !== null && minutesSeason !== null ? minutesL5 - minutesSeason : null;

  if (!opp) return null;
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 pt-3">
      <div className="flex items-center gap-2.5">
        <Logo sources={[opp.logoUrl]} alt={opp.name} fallbackText={opp.abbreviation} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{opp.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {byPosition ? `vs ${POSITION_GROUP_LABEL[group]} · ` : "Defense · "}
            {stat.label.toLowerCase()}
            {defense.fromLastSeason ? " · last season" : ""}
          </p>
        </div>
        {grade && (
          <span className={`rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wide ${GRADE[grade].bg} ${GRADE[grade].text}`}>
            {GRADE[grade].label}
          </span>
        )}
      </div>
      <div className="mt-1 divide-y divide-border">
        {m ? (
          <Metric
            label={byPosition ? `${stat.shortLabel} allowed to ${POSITION_GROUP_LABEL[group]} / game` : `${stat.shortLabel} allowed / game`}
            value={m.perGame.toFixed(1)}
            sub={`${ordinal(m.rank)} of ${m.of} · lg ${m.leagueAvg.toFixed(1)}`}
          >
            <RankTrack rank={m.rank} of={m.of} grade={grade!} />
            <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wide text-muted-foreground">
              <span>Gives up most</span>
              <span>Gives up least</span>
            </div>
          </Metric>
        ) : (
          <Metric label={`${stat.shortLabel} allowed / game`} value="—" sub="not enough games" />
        )}
        {pace && (
          <Metric label="Pace (combined pts / game)" value={pace.combinedPoints.toFixed(1)} sub={`${ordinal(pace.rank)} fastest`} />
        )}
        {h2h && (
          <Metric
            label={`vs ${opp.abbreviation}, this + last season`}
            value={h2h.avg === null ? "—" : `${h2h.avg.toFixed(1)} avg`}
            sub={h2h.rate.sampleSize ? `${h2h.rate.hits}/${h2h.rate.sampleSize} ${side}` : "no meetings"}
          />
        )}
        {minutesL5 !== null && (
          <Metric
            label="Minutes, last 5"
            value={minutesL5.toFixed(1)}
            sub={
              minutesDelta === null
                ? undefined
                : Math.abs(minutesDelta) < 0.5
                  ? "even with season"
                  : `${minutesDelta > 0 ? "▲" : "▼"} ${Math.abs(minutesDelta).toFixed(1)} vs season`
            }
          />
        )}
      </div>
    </div>
  );
}
