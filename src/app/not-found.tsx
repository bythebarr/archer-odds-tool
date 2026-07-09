import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TargetMark } from "@/components/TargetMark";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center gap-4 px-4 text-center font-sans">
      <TargetMark size={116} arrow="miss" />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold text-foreground">That shot missed the mark</h1>
        <p className="text-sm text-muted-foreground">
          This page, game, or team isn&apos;t on the board.
        </p>
      </div>
      <Button variant="link" render={<Link href="/" />} className="h-auto p-0 text-sm font-medium">
        ← Back to the board
      </Button>
    </div>
  );
}
