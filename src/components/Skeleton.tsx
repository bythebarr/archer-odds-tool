interface SkeletonProps {
  className?: string;
}

/** A single pulsing placeholder block, sized/positioned by the caller's className. */
export function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`animate-pulse rounded bg-zinc-200 dark:bg-zinc-800 ${className}`} />;
}

/** One game-row-shaped skeleton, matching HomeGamesList/SlateLinesView's row layout. */
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
