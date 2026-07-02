import { z } from "zod";
import { listGames } from "@/lib/queries/games";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");

  if (dateParam !== null) {
    const parsed = dateSchema.safeParse(dateParam);
    if (!parsed.success) {
      return Response.json({ error: "Invalid date, expected YYYY-MM-DD" }, { status: 400 });
    }
  }

  try {
    const games = await listGames(dateParam ?? undefined);
    return Response.json(games);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
