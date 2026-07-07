import { formatPoint } from "@/lib/odds/format";
import type { GameLineRow } from "@/lib/queries/games";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const stringValue = value === MAIN_LINE || value === ALL_ALT_LINES ? value : String(value);
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      Line
      <Select
        value={stringValue}
        onValueChange={(v) => onChange(v === MAIN_LINE || v === ALL_ALT_LINES ? v : Number(v))}
      >
        <SelectTrigger size="sm" className="text-xs">
          <SelectValue>
            {(v: string) => {
              if (v === MAIN_LINE) return "Main line";
              if (v === ALL_ALT_LINES) return "All alt lines";
              return formatPoint(Number(v), market);
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={MAIN_LINE}>Main line</SelectItem>
          <SelectItem value={ALL_ALT_LINES}>All alt lines</SelectItem>
          {pointOptions.map((p) => (
            <SelectItem key={p} value={String(p)}>
              {formatPoint(p, market)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
