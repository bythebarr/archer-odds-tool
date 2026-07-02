"use client";

import Link from "next/link";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-2 px-4 text-center font-sans">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Something went wrong
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        The page hit an unexpected error. Try again, or head back to today&apos;s games.
      </p>
      <div className="mt-2 flex gap-4">
        <button
          onClick={reset}
          className="text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50"
        >
          Try again
        </button>
        <Link href="/" className="text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50">
          ← Today&apos;s games
        </Link>
      </div>
    </div>
  );
}
