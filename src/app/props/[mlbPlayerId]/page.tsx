import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMlbPlayerById, getOpposingProbableHand } from "@/lib/queries/props";
import { computePropHitRateSplits } from "@/lib/props/hitRate";
import { PlayerBadge } from "@/components/PlayerBadge";
import { BackLink } from "@/components/BackLink";
import { PropControlsPanel } from "@/components/PropControlsPanel";

const DEFAULT_STAT_CATEGORY = "hits" as const;
const DEFAULT_LINE = 0.5;
const DEFAULT_DIRECTION = "over" as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ mlbPlayerId: string }>;
}): Promise<Metadata> {
  const { mlbPlayerId } = await params;
  const player = await getMlbPlayerById(mlbPlayerId);
  if (!player) return {};
  return { title: player.fullName, description: `${player.fullName} — MLB prop hit-rates.` };
}

export default async function PlayerPropsPage({
  params,
  searchParams,
}: {
  params: Promise<{ mlbPlayerId: string }>;
  searchParams: Promise<{ vsGame?: string; team?: string }>;
}) {
  const { mlbPlayerId } = await params;
  const { vsGame, team } = await searchParams;

  const player = await getMlbPlayerById(mlbPlayerId);
  if (!player) notFound();

  const [initialSplits, opposingHand] = await Promise.all([
    computePropHitRateSplits({
      mlbPlayerId,
      statCategory: DEFAULT_STAT_CATEGORY,
      line: DEFAULT_LINE,
      direction: DEFAULT_DIRECTION,
    }),
    vsGame && team ? getOpposingProbableHand(vsGame, team) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <BackLink fallbackHref="/props" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
        ← Back
      </BackLink>

      <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold text-foreground">
        <PlayerBadge name={player.fullName} mlbPersonId={player.mlbPersonId} size={32} />
        {player.fullName}
      </h1>
      <p className="text-sm text-muted-foreground">
        {player.batSide && `Bats ${player.batSide}`}
        {player.batSide && player.pitchHand && " · "}
        {player.pitchHand && `Throws ${player.pitchHand}`}
      </p>

      <PropControlsPanel
        mlbPlayerId={mlbPlayerId}
        initialStatCategory={DEFAULT_STAT_CATEGORY}
        initialLine={DEFAULT_LINE}
        initialDirection={DEFAULT_DIRECTION}
        initialSplits={initialSplits}
        highlightHand={opposingHand}
      />
    </div>
  );
}
