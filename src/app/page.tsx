import { getDashboardForDate } from "@/lib/queries/dashboard";
import { todayEt, isValidEtDate, formatEtDateLabel } from "@/lib/dateEt";
import { DashboardHome } from "@/components/dashboard/DashboardHome";
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

  // The home board surfaces UFC leans, so keep the upcoming feed fresh on view.
  refreshUpcomingUfcOnView();
  const dashboard = await getDashboardForDate(date);

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-8 font-sans">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {formatEtDateLabel(date)}
      </p>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Today&apos;s board</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">
          {dashboard.total} play{dashboard.total === 1 ? "" : "s"}
        </span>{" "}
        across every sport — model leans are free signals; live-odds EV lights up once paid coverage is on.
      </p>

      <div className="mt-6">
        <DashboardHome dashboard={dashboard} date={date} />
      </div>
    </div>
  );
}
