import type { Metadata } from "next";
import { LeaguePage } from "@/components/book/LeaguePage";
import { refreshOnView } from "@/lib/ops/refreshOnView";

export const metadata: Metadata = {
  title: "NBA odds — best spread, total and moneyline",
  description: "Every NBA game with the best spread, total and moneyline across sportsbooks, day by day.",
};

export const dynamic = "force-dynamic";

export default async function NbaPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  await refreshOnView([["espn-odds", 30], ["sync-results-nba", 60]]);
  return <LeaguePage sport="nba" dateParam={date} />;
}
