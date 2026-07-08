import { getHomeForDate } from "@/lib/queries/dashboard";
import { todayEt, isValidEtDate, formatEtDateLabel } from "@/lib/dateEt";
import { HomeLauncher } from "@/components/dashboard/HomeLauncher";
import { refreshUpcomingUfcOnView } from "@/lib/ufc/refreshUpcoming";

// The board changes day to day (fed by the sport syncs) — render per request.
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && isValidEtDate(dateParam) ? dateParam : todayEt();

  // The home surfaces the UFC card, so keep the upcoming feed fresh on view.
  refreshUpcomingUfcOnView();
  const home = await getHomeForDate(date);

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-7 font-sans">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {formatEtDateLabel(date)}
      </p>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Today on archer</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick a sport to dive in, or jump to the{" "}
        <span className="font-medium text-foreground">full slate</span> for every play in one pool.
      </p>

      <div className="mt-6">
        <HomeLauncher home={home} date={date} />
      </div>
    </div>
  );
}
