import { redirect } from "next/navigation";

// The MLB board is now the single canonical `/mlb`. This route stays only so
// old links/bookmarks (and the Slate's "Shop all MLB lines →") don't 404 — it
// forwards to `/mlb`, preserving the browsed date.
export default async function SlateMlbRedirect({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  redirect(date ? `/mlb?date=${date}` : "/mlb");
}
