import type { Metadata } from "next";
import { LeaguePage } from "@/components/book/LeaguePage";

export const metadata: Metadata = {
  title: "NFL odds — best spread, total and moneyline",
  description: "Every NFL game with the best spread, total and moneyline across sportsbooks, day by day.",
};

export const dynamic = "force-dynamic";

export default async function NflPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  return <LeaguePage sport="nfl" dateParam={date} />;
}
