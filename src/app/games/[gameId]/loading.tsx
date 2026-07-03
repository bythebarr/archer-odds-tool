import { Skeleton } from "@/components/Skeleton";

export default function GameLoading() {
  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <Skeleton className="h-4 w-12" />
      <Skeleton className="mt-2 h-7 w-72" />
      <Skeleton className="mt-2 h-4 w-52" />

      <div className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <Skeleton className="h-3 w-20" />
        <div className="mt-3 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
          <div className="border-b-2 border-transparent px-3 py-2">
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="px-3 py-2">
            <Skeleton className="h-4 w-12" />
          </div>
          <div className="px-3 py-2">
            <Skeleton className="h-4 w-12" />
          </div>
        </div>
        <Skeleton className="mt-6 h-12 w-full" />
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-24" />
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-8 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
