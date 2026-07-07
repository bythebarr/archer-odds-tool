import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMlbTeamById } from "@/lib/queries/games";
import { getRecentTeamPlayers } from "@/lib/queries/props";
import { BackLink } from "@/components/BackLink";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ teamId: string }>;
}): Promise<Metadata> {
  const { teamId } = await params;
  const team = await getMlbTeamById(teamId);
  if (!team) return {};
  return { title: `${team.name} — Player Props`, description: `Recently-active ${team.name} players.` };
}

export default async function TeamPropsPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const team = await getMlbTeamById(teamId);
  if (!team) notFound();

  const recentPlayers = await getRecentTeamPlayers(teamId);

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <BackLink fallbackHref="/props" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
        ← Back
      </BackLink>

      <h1 className="mt-2 text-xl font-semibold text-foreground">{team.name}</h1>
      <p className="text-sm text-muted-foreground">
        Recently-active players (last 45 days) — not an official lineup or roster.
      </p>

      <ul className="mt-6 divide-y divide-border">
        {recentPlayers.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">
            No recent game logs for this team.
          </li>
        )}
        {recentPlayers.map(({ player }) => (
          <li key={player.id}>
            <Link
              href={`/props/${player.id}`}
              className="block py-3 text-sm font-medium text-foreground hover:bg-accent/50"
            >
              {player.fullName}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
