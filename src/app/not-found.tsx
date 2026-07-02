import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-2 px-4 text-center font-sans">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Not found</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        That page, game, or team doesn&apos;t exist.
      </p>
      <Link href="/" className="mt-2 text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50">
        ← Back to today&apos;s games
      </Link>
    </div>
  );
}
