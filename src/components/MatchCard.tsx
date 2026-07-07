import type { ReactNode } from "react";
import Link from "next/link";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface MatchCardCompetitor {
  badge: ReactNode;
  label: string;
}

export interface MatchCardChip {
  label: string;
  value: string;
}

interface MatchCardProps {
  href: string;
  /** Two competitors — displayed left-to-right with a "vs" divider, matching the home game cards. */
  competitors: [MatchCardCompetitor, MatchCardCompetitor];
  timeLabel: string;
  status: string;
  isLive?: boolean;
  score?: string | null;
  chips: MatchCardChip[];
}

/**
 * Shared presentational card for a single match/game in a list view. Server-safe
 * (no hooks) so tennis/soccer list pages can render it directly. The MLB home
 * list has its own client component because it also owns a market-tab toggle.
 */
export function MatchCard({ href, competitors, timeLabel, status, isLive, score, chips }: MatchCardProps) {
  const [away, home] = competitors;
  return (
    <Link href={href} className="block">
      <Card className="transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md hover:ring-primary/40">
        <CardContent className="flex items-center justify-between gap-4">
          <div className="flex flex-1 items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {away.badge}
              <span className="truncate text-sm font-semibold text-foreground">{away.label}</span>
            </div>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">vs</span>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
              <span className="truncate text-sm font-semibold text-foreground">{home.label}</span>
              {home.badge}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-sm font-medium text-foreground">{timeLabel}</span>
            {isLive ? (
              <Badge className="border-transparent bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-red-500" />
                LIVE
                {score ? ` ${score}` : ""}
              </Badge>
            ) : (
              <span className="text-xs uppercase text-muted-foreground">
                {status}
                {status !== "scheduled" && score ? ` · ${score}` : ""}
              </span>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex-wrap gap-2 border-t-0 bg-transparent p-0 px-(--card-spacing) pb-(--card-spacing)">
          {chips.length === 0 ? (
            <span className="text-xs text-muted-foreground">No odds polled yet</span>
          ) : (
            chips.map((chip) => (
              <Badge key={chip.label} variant="outline" className="font-mono">
                {chip.label} {chip.value}
              </Badge>
            ))
          )}
        </CardFooter>
      </Card>
    </Link>
  );
}
