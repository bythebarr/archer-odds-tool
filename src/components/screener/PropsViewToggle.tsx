import Link from "next/link";

/**
 * A sport's props page in two views: its board (the sport's own finder) and
 * the screener with the filters column. The view lives in the URL (?view=screen).
 */
export function PropsViewToggle({ basePath, screen, boardQuery = "" }: { basePath: string; screen: boolean; boardQuery?: string }) {
  const chip = (on: boolean) =>
    `flex-1 rounded-full px-3 py-1.5 text-center text-xs font-semibold transition-colors ${on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`;
  return (
    <div className="mt-3 flex max-w-sm gap-1 rounded-full bg-muted p-1">
      <Link href={`${basePath}${boardQuery}`} className={chip(!screen)} aria-current={!screen ? "page" : undefined}>
        Board
      </Link>
      <Link href={`${basePath}?view=screen`} className={chip(screen)} aria-current={screen ? "page" : undefined}>
        Filters &amp; screener
      </Link>
    </div>
  );
}

/** Whether a props page's URL asks for the screener. */
export const wantsScreen = (p: { view?: string }) => p.view === "screen";
