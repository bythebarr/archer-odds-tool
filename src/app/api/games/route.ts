import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date"); // YYYY-MM-DD, UTC calendar day

  const where = date
    ? {
        scheduledStartUtc: {
          gte: new Date(`${date}T00:00:00Z`),
          lt: new Date(`${date}T23:59:59.999Z`),
        },
      }
    : {};

  const games = await prisma.game.findMany({
    where,
    orderBy: { scheduledStartUtc: "asc" },
    include: { homeTeam: true, awayTeam: true },
  });

  return Response.json(
    games.map((g) => ({
      id: g.id,
      mlbGameId: g.mlbGameId,
      scheduledStartUtc: g.scheduledStartUtc,
      status: g.status,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      homeTeam: {
        id: g.homeTeam.id,
        name: g.homeTeam.name,
        abbreviation: g.homeTeam.abbreviation,
      },
      awayTeam: {
        id: g.awayTeam.id,
        name: g.awayTeam.name,
        abbreviation: g.awayTeam.abbreviation,
      },
    }))
  );
}
