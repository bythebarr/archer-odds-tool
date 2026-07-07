import type { Handedness } from "@/generated/prisma/client";
import type { PropHitRateResult, PropHitRateSplits } from "@/lib/props/hitRate";
import { formatPropHitRate } from "@/lib/props/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface SplitCellProps {
  label: string;
  result: PropHitRateResult;
  highlighted?: boolean;
}

function SplitCell({ label, result, highlighted }: SplitCellProps) {
  return (
    <div
      className={`rounded-md border p-2 text-center ${
        highlighted ? "border-primary ring-1 ring-primary" : "border-border"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{formatPropHitRate(result)}</p>
    </div>
  );
}

interface PropHitRateSplitsCardProps {
  splits: PropHitRateSplits;
  line: number;
  direction: "over" | "under";
  statLabel: string;
  /** Which hand-split to visually highlight (e.g. today's actual opposing probable starter) — undefined/null means no highlight. */
  highlightHand?: Handedness | null;
}

/** Presentational only — no data fetching, so it's reusable by a future slate-wide props browser. */
export function PropHitRateSplitsCard({
  splits,
  line,
  direction,
  statLabel,
  highlightHand,
}: PropHitRateSplitsCardProps) {
  const directionLabel = direction === "over" ? "Over" : "Under";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-foreground">
          {directionLabel} {line} {statLabel}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <SplitCell label="L3" result={splits.l3} />
          <SplitCell label="L5" result={splits.l5} />
          <SplitCell label="L10" result={splits.l10} />
          <SplitCell label="L15" result={splits.l15} />
          <SplitCell label="Season" result={splits.season} />
        </div>

        <Separator className="my-4" />

        <div className="grid grid-cols-2 gap-2">
          <SplitCell label="vs LHP" result={splits.vsLhp} highlighted={highlightHand === "L"} />
          <SplitCell label="vs RHP" result={splits.vsRhp} highlighted={highlightHand === "R"} />
        </div>
      </CardContent>
    </Card>
  );
}
