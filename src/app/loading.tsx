import { Skeleton, GameRowSkeleton } from "@/components/Skeleton";

export default function HomeLoading() {
  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <Skeleton className="h-4 w-72" />

      <div className="mt-6 flex items-center justify-between">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>

      <div className="mt-6">
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
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {Array.from({ length: 7 }).map((_, i) => (
            <GameRowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
