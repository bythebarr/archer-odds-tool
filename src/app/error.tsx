"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-2 px-4 text-center font-sans">
      <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        The page hit an unexpected error. Try again, or head back to today&apos;s games.
      </p>
      <div className="mt-2 flex gap-4">
        <Button variant="link" onClick={reset} className="h-auto p-0 text-sm font-medium">
          Try again
        </Button>
        <Button variant="link" render={<Link href="/" />} className="h-auto p-0 text-sm font-medium">
          ← Today&apos;s games
        </Button>
      </div>
    </div>
  );
}
