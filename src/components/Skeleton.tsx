import { Skeleton } from "@/components/ui/skeleton";

export { Skeleton };

/** One game-row-shaped skeleton, matching SlateLinesView's row layout. */
export function GameRowSkeleton() {
  return (
    <div className="flex items-center justify-between py-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="flex flex-col items-end gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

/** One card-shaped skeleton, matching the DraftKings-style MatchCard rows. */
export function MatchCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-(--card-spacing)">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-3">
          <div className="flex flex-col items-center gap-1.5">
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="h-3 w-8" />
          </div>
          <Skeleton className="h-3 w-4" />
          <div className="flex flex-col items-center gap-1.5">
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="h-3 w-8" />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    </div>
  );
}

/**
 * Full-page skeleton for a card-based list route (tennis, soccer, props hub) —
 * mirrors the shared `max-w-2xl px-4 py-10` container + an h1 + a stack of
 * MatchCard skeletons, so navigation shows structure instead of a blank stall.
 */
export function CardListPageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-2 h-4 w-72" />
      <div className="mt-8 flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <MatchCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/**
 * Full-page skeleton for a detail route (a match/player page) — a back link,
 * a title band, and two content cards under the shared container.
 */
export function DetailPageSkeleton() {
  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-7 w-64" />
      <Skeleton className="mt-2 h-4 w-40" />
      <div className="mt-8 flex flex-col gap-4">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
    </div>
  );
}
