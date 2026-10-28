import type { Metadata } from "next";
import Link from "next/link";
import { getMlbPropsSlate, mlbPropDates } from "@/lib/queries/mlbProps";
import { isValidEtDate } from "@/lib/dateEt";
import { SportPage } from "@/components/book/SportPage";
import { SportTabs } from "@/components/book/SportTabs";
import { EmptyState } from "@/components/EmptyState";
import { MlbPropsFinder } from "@/components/mlb/MlbPropsFinder";

export const metadata: Metadata = {
  title: "MLB Props — hits, total bases, home runs, strikeouts",
  description: "MLB player props for every batter and starter: ARCHR's chance at the books' line, the best price, and every game charted.",
};

export const dynamic = "force-dynamic";

const dayLabel = (d: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

export default async function MlbPropsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: dateParam } = await searchParams;
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && isValidEtDate(dateParam) ? dateParam : null;
  const [slate, dates] = await Promise.all([getMlbPropsSlate(date), mlbPropDates()]);

  return (
    <SportPage sport="mlb" width="2xl">
      <div className="mt-3">
        <SportTabs
          tabs={[
            { label: "Game Lines", href: "/mlb", active: false },
            { label: "Player Props", href: "/mlb/props", active: true },
          ]}
        />
      </div>
      {dates.length > 1 && (
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {dates.map((d) => (
            <Link key={d} href={`/mlb/props?date=${d}`} className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold ${d === slate.date ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {dayLabel(d)}
            </Link>
          ))}
        </div>
      )}
      {slate.props.length === 0 ? (
        <div className="mt-8">
          <EmptyState title={slate.games.length ? "No player props priced for these games yet" : "No MLB games on this date"}>
            {slate.games.length
              ? "Props show once the lineups or probable starters are in; the starters usually post a day or two ahead."
              : "The season's over or it's an off day — the next slate shows here as soon as it's scheduled."}
          </EmptyState>
        </div>
      ) : (
        <MlbPropsFinder key={slate.date} slate={slate} />
      )}
    </SportPage>
  );
}
