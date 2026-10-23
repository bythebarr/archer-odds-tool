import { ArchrMark } from "./ArchrMark";
import { Skeleton } from "@/components/Skeleton";

/** The mark in flight: a volt copy revealed along the arrow's path over a muted one. */
export function BrandLoader({ className = "h-9" }: { className?: string }) {
  return (
    <span role="status" aria-label="Loading" className="relative inline-block">
      <ArchrMark className={`${className} w-auto text-muted-foreground/25`} />
      <ArchrMark className={`archr-flight absolute inset-0 ${className} w-auto text-foreground dark:text-brand`} />
    </span>
  );
}

/** Loading state for the lobby and league pages: the loader over the shape of the board. */
export function BookPageSkeleton() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-10 pt-5 font-sans">
      <div className="flex gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex w-14 flex-col items-center gap-1.5">
            <Skeleton className="size-12 rounded-full" />
            <Skeleton className="h-2.5 w-8" />
          </div>
        ))}
      </div>
      <div className="mt-10 flex justify-center">
        <BrandLoader />
      </div>
      <div className="mt-8 flex flex-col gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-3">
            <Skeleton className="h-3 w-16" />
            {[0, 1].map((r) => (
              <div key={r} className="mt-2.5 flex items-center gap-2">
                <Skeleton className="size-7 rounded-full" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-12 w-[4.25rem] rounded-lg" />
                <Skeleton className="h-12 w-[4.25rem] rounded-lg" />
                <Skeleton className="h-12 w-[4.25rem] rounded-lg" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
