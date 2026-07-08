import type { Metadata } from "next";
import { getSportNav } from "@/lib/queries/sportNav";
import { todayEt, isValidEtDate } from "@/lib/dateEt";
import { SportCard } from "@/components/SportCard";
import { PageShell, PageHeader } from "@/components/PageShell";

export const metadata: Metadata = {
  title: "All Sports",
  description: "Every sport Archer covers — in-season boards and what's on today.",
};

// Rides the daily slate, so what's "live today" changes day to day.
export const dynamic = "force-dynamic";

/**
 * The all-sports lobby — the books-style "A–Z" door reached from the SportRail's
 * "All Sports" pill. Splits sports into what's live today vs. idle so the
 * in-season boards surface first, and scales automatically as sports are added.
 */
export default async function SportsLobbyPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && isValidEtDate(dateParam) ? dateParam : todayEt();

  const items = await getSportNav(date);
  const live = items.filter((i) => i.count > 0);
  const idle = items.filter((i) => i.count === 0);

  return (
    <PageShell width="2xl">
      <PageHeader
        title="All Sports"
        description="Every sport Archer covers. What's playing today is up top; the rest are ready when their season is."
      />

      {live.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live today</h2>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {live.map((s) => (
              <SportCard key={s.sport} {...s} date={date} />
            ))}
          </div>
        </section>
      )}

      {idle.length > 0 && (
        <section className="mt-7">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Not playing today</h2>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {idle.map((s) => (
              <SportCard key={s.sport} {...s} date={date} />
            ))}
          </div>
        </section>
      )}

      <p className="mt-7 text-center text-xs text-muted-foreground">
        More sports coming as their seasons open.
      </p>
    </PageShell>
  );
}
