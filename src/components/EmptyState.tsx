import Link from "next/link";
import type { ReactNode } from "react";
import { TargetMark } from "@/components/TargetMark";
import type { FeedFreshness } from "@/lib/freshness";

/**
 * The one empty-state block, so a paying user never hits a confusing blank.
 * It always answers "is this broken or just not up yet?": an on-brand target
 * mark, a plain-language reason, the feed's real update cadence + last-updated
 * time when a `freshness` feed is passed, and a standing door to support. Used
 * anywhere a board can legitimately have nothing to show.
 */
export function EmptyState({
  title,
  children,
  freshness,
  arrow = "none",
  supportContext,
}: {
  title: string;
  children?: ReactNode;
  freshness?: FeedFreshness;
  arrow?: "none" | "miss";
  /** Prefills the feedback form's context so a report says where it came from. */
  supportContext?: string;
}) {
  const supportHref = supportContext ? `/support?from=${encodeURIComponent(supportContext)}` : "/support";
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-14 text-center">
      <TargetMark size={92} arrow={arrow} />
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {children ? <p className="text-sm text-muted-foreground">{children}</p> : null}
        {freshness ? (
          <p className="text-sm text-muted-foreground">
            {freshness.label[0].toUpperCase() + freshness.label.slice(1)} refresh {freshness.cadence}.
            {freshness.ageLabel ? ` Last updated ${freshness.ageLabel}.` : ""}
          </p>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Still looks off?{" "}
        <Link href={supportHref} className="font-medium text-foreground/70 underline hover:text-foreground">
          Let us know
        </Link>
        .
      </p>
    </div>
  );
}
