import { Skeleton } from "@/components/Skeleton";

export default function PropBoardLoading() {
  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-10 font-sans">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-2 h-4 w-96" />

      <div className="mt-5 flex gap-2">
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>

      <div className="mt-8 flex gap-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-16 rounded-full" />
        ))}
      </div>

      <div className="mt-6 divide-y divide-border/40">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2.5">
            <Skeleton className="h-[30px] w-[30px] rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
