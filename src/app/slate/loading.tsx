import { Skeleton } from "@/components/Skeleton";

export default function SlateLoading() {
  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-10 font-sans">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="mt-2 h-4 w-80" />

      <div className="mt-6 flex items-center justify-between">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>

      <div className="mt-8 flex gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-16 rounded-full" />
        ))}
      </div>

      <div className="mt-5 divide-y divide-border/50">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2.5">
            <Skeleton className="h-4 w-5" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
