import { redirect } from "next/navigation";

// The props board now lives at `/props` itself (board-first, with a Teams
// toggle). This route is kept only so old links/bookmarks don't 404 — it
// forwards to `/props`, preserving any date/view/stat query params.
export default async function PropBoardRedirect({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; stat?: string }>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null) as [string, string][]
  ).toString();
  redirect(qs ? `/props?${qs}` : "/props");
}
