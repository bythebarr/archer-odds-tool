import type { FeedFreshness } from "@/lib/freshness";

/**
 * A quiet "Updated 2h ago" chip for the top of a board — reassurance that the
 * data is live and roughly how fresh it is. Server-rendered from PollLog; the
 * age is coarse on purpose, so it doesn't need to tick. Renders nothing if the
 * feed has never updated (the EmptyState carries that message instead).
 */
export function FreshnessStamp({ freshness }: { freshness: FeedFreshness }) {
  if (!freshness.ageLabel) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={`${freshness.label} last refreshed ${freshness.ageLabel}`}>
      <span
        aria-hidden
        className={`inline-block size-1.5 rounded-full ${freshness.errored ? "bg-amber-500" : "bg-emerald-500"}`}
      />
      Updated {freshness.ageLabel}
    </span>
  );
}
