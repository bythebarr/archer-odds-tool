import type { SlateSport, SlateSide } from "@/lib/queries/slate";
import { TeamBadge } from "@/components/TeamBadge";
import { FighterBadge } from "@/components/FighterBadge";
import { TennisPlayerBadge } from "@/components/TennisPlayerBadge";

/**
 * One competitor's avatar, sport-aware — the single place that maps a Slate
 * side to the right identity treatment: real UFC headshots, MLB team crests
 * (via the club-id CDN), a tennis player's initials badge, or a soccer team's
 * color/initials badge. Everything degrades to an initials badge, so a missing
 * photo/crest never breaks the layout.
 */
export function CompetitorAvatar({
  sport,
  side,
  size = 28,
}: {
  sport: SlateSport;
  side: SlateSide;
  size?: number;
}) {
  if (sport === "ufc") return <FighterBadge name={side.name} imageUrl={side.imageUrl ?? null} size={size} />;
  if (sport === "tennis") return <TennisPlayerBadge name={side.name} size={size} />;
  // mlb (real crest via teamId) + soccer (color/initials fallback) both use TeamBadge.
  return <TeamBadge abbreviation={side.meta ?? side.name} name={side.name} mlbTeamId={side.teamId} size={size} />;
}
