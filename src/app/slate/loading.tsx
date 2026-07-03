import { Skeleton } from "@/components/Skeleton";

export default function SlateLoading() {
  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-10 font-sans">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-2 h-4 w-80" />

      <div className="mt-6 flex items-center justify-between">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
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

        <Skeleton className="mt-6 h-5 w-full" />
        <Skeleton className="mt-4 h-32 w-full" />

        <div className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-3">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
