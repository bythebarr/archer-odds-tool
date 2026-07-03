import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const p = new PrismaClient({ adapter });

async function main() {
  const g = await p.game.findFirst({ where: { status: "scheduled" }, orderBy: { scheduledStartUtc: "asc" } });
  console.log("GAMEID", g?.id);
  console.log("outcomeCount", await p.gameOutcome.count());
  console.log("finalGames", await p.game.count({ where: { status: "final" } }));
  console.log("snapshotCount", await p.oddsSnapshot.count());
}
main().then(() => process.exit(0));
