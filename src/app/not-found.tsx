import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-2 px-4 text-center font-sans">
      <h1 className="text-xl font-semibold text-foreground">Not found</h1>
      <p className="text-sm text-muted-foreground">That page, game, or team doesn&apos;t exist.</p>
      <Button variant="link" render={<Link href="/" />} className="mt-2 h-auto p-0 text-sm font-medium">
        ← Back to today&apos;s games
      </Button>
    </div>
  );
}
