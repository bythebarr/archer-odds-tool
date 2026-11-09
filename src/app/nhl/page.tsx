import type { Metadata } from "next";
import { LeaguePage } from "@/components/book/LeaguePage";
import { refreshOnView } from "@/lib/ops/refreshOnView";

export const metadata: Metadata = {
  title: "NHL odds — best puck line, total and moneyline",
  description: "Every NHL game with the best puck line, total and moneyline across sportsbooks, day by day.",
};

export const dynamic = "force-dynamic";

export default async function NhlPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  await refreshOnView([["sync-injuries", 20], ["espn-odds", 30], ["sync-results-nhl", 60]]);
  return <LeaguePage sport="nhl" dateParam={date} />;
}
