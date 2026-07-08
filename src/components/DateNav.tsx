import Link from "next/link";
import { shiftEtDate, formatEtDateLabel } from "@/lib/dateEt";

/**
 * The shared "← Prev day / {date} / Next day →" control. `basePath` is the
 * route it links within; `extraQuery` carries any params that must survive day
 * nav (e.g. the Slate's active tab, the props board's active view) and should
 * start with "&" when present.
 */
export function DateNav({
  basePath,
  date,
  extraQuery = "",
}: {
  basePath: string;
  date: string;
  extraQuery?: string;
}) {
  const prevDate = shiftEtDate(date, -1);
  const nextDate = shiftEtDate(date, 1);

  return (
    <div className="mt-6 flex items-center justify-between">
      <Link
        href={`${basePath}?date=${prevDate}${extraQuery}`}
        className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
      >
        ← Prev day
      </Link>
      <span className="text-sm font-medium text-foreground">{formatEtDateLabel(date)}</span>
      <Link
        href={`${basePath}?date=${nextDate}${extraQuery}`}
        className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
      >
        Next day →
      </Link>
    </div>
  );
}
