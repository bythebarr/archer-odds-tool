import { Skeleton } from "@/components/Skeleton";

/** Shaped like the props finder — controls, then player cards — so the page doesn't jump when data lands. */
export default function NbaPropsLoading() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 py-10">
      <Skeleton className="h-7 w-36" />
      <Skeleton className="mt-2 h-4 w-72" />
      <Skeleton className="mt-6 h-5 w-full" />
      <div className="mt-6 flex gap-1.5">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-12 rounded-full" />
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Skeleton className="h-7 w-28 rounded-lg" />
        <Skeleton className="h-7 w-24 rounded-lg" />
        <Skeleton className="h-7 flex-1 rounded-lg" />
      </div>
      <div className="mt-6 flex flex-col gap-2.5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-3.5">
            <div className="flex items-center gap-3">
              <Skeleton className="size-12 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-6 w-14" />
            </div>
            <div className="mt-3 flex justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-6 w-24 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
