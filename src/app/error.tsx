"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TargetMark } from "@/components/TargetMark";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center gap-4 px-4 text-center font-sans">
      <TargetMark size={116} arrow="none" />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          The page hit an unexpected error. Take another shot, or head back to the board.
        </p>
      </div>
      <div className="flex gap-4">
        <Button variant="link" onClick={reset} className="h-auto p-0 text-sm font-medium">
          Try again
        </Button>
        <Button variant="link" render={<Link href="/" />} className="h-auto p-0 text-sm font-medium">
          ← Back to the board
        </Button>
      </div>
    </div>
  );
}
