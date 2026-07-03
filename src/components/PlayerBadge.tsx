import { playerLogoSources } from "@/lib/logos";
import { Logo } from "./Logo";

interface PlayerBadgeProps {
  name: string;
  size?: number;
}

/** First letter of first + last name (e.g. "Alex de Minaur" -> "AM"); single-word names just take the first two letters. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Player headshot (falls back to a neutral initials badge — unlike teams,
 * players have no brand color, see TEAM_COLORS). The Logo+playerLogoSources
 * wiring used everywhere a tennis player is shown.
 */
export function PlayerBadge({ name, size }: PlayerBadgeProps) {
  return (
    <Logo sources={playerLogoSources(name)} alt={name} fallbackText={initialsFor(name)} size={size} />
  );
}
