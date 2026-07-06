import { formatPoint } from "@/lib/odds/format";
import type { GameLineRow } from "@/lib/queries/games";

export const MAIN_LINE = "main" as const;
export const ALL_ALT_LINES = "alt" as const;
export type PointFilter = typeof MAIN_LINE | typeof ALL_ALT_LINES | number;

interface PointFilterSelectProps {
  pointOptions: number[];
  value: PointFilter;
  onChange: (value: PointFilter) => void;
  market: GameLineRow["marketType"];
}

/** "Line" dropdown shared by GameLinesView/SlateLinesView: jump to the main line, every alt line pooled together, or one specific point on offer. */
export function PointFilterSelect({ pointOptions, value, onChange, market }: PointFilterSelectProps) {
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      Line
      <select
        value={value === MAIN_LINE || value === ALL_ALT_LINES ? value : String(value)}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === MAIN_LINE || v === ALL_ALT_LINES ? v : Number(v));
        }}
        className="rounded border border-zinc-200 bg-transparent px-2 py-1 text-xs text-zinc-900 dark:border-zinc-800 dark:text-zinc-50"
      >
        <option value={MAIN_LINE}>Main line</option>
        <option value={ALL_ALT_LINES}>All alt lines</option>
        {pointOptions.map((p) => (
          <option key={p} value={p}>
            {formatPoint(p, market)}
          </option>
        ))}
      </select>
    </label>
  );
}
