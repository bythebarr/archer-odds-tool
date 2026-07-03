import { formatPoint } from "@/lib/odds/format";

export const MAIN_LINE = "main" as const;
export type PointFilter = typeof MAIN_LINE | number;

interface PointFilterSelectProps {
  pointOptions: number[];
  value: PointFilter;
  onChange: (value: PointFilter) => void;
}

/** "Line" dropdown shared by GameLinesView/SlateLinesView: jump to the main line or a specific point on offer. */
export function PointFilterSelect({ pointOptions, value, onChange }: PointFilterSelectProps) {
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      Line
      <select
        value={value === MAIN_LINE ? MAIN_LINE : String(value)}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === MAIN_LINE ? MAIN_LINE : Number(v));
        }}
        className="rounded border border-zinc-200 bg-transparent px-2 py-1 text-xs text-zinc-900 dark:border-zinc-800 dark:text-zinc-50"
      >
        <option value={MAIN_LINE}>Main line</option>
        {pointOptions.map((p) => (
          <option key={p} value={p}>
            {formatPoint(p)}
          </option>
        ))}
      </select>
    </label>
  );
}
