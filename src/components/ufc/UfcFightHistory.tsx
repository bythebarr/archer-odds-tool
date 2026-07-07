import type { UfcFightRecord, UfcFightResult } from "@/lib/queries/ufcMatchup";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const RESULT_STYLE: Record<UfcFightResult, { label: string; className: string }> = {
  win: { label: "W", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  loss: { label: "L", className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  draw: { label: "D", className: "bg-muted text-muted-foreground" },
  noContest: { label: "NC", className: "bg-muted text-muted-foreground" },
};

interface UfcFightHistoryProps {
  fighterName: string;
  fights: UfcFightRecord[];
  limit?: number;
}

function formatFightDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "America/New_York" }).format(date);
}

/** Compact recent-fights list for one fighter — the raw history the fighter-math strength layer is computed from. */
export function UfcFightHistory({ fighterName, fights, limit = 5 }: UfcFightHistoryProps) {
  const recent = fights.slice(0, limit);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-foreground">{fighterName} — recent fights</CardTitle>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">No fight history on file.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {recent.map((fight) => {
              const style = RESULT_STYLE[fight.result];
              return (
                <li key={fight.boutId} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`inline-flex h-5 w-6 shrink-0 items-center justify-center rounded text-[11px] font-bold ${style.className}`}
                    >
                      {style.label}
                    </span>
                    <span className="truncate text-sm text-foreground">{fight.opponentName}</span>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-muted-foreground">
                      {fight.method ?? "—"}
                      {fight.resultRound ? ` R${fight.resultRound}` : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{formatFightDate(fight.eventDate)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
