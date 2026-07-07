import { playerLogoSources, mlbHeadshotUrl } from "@/lib/logos";
import { Logo } from "./Logo";

interface PlayerBadgeProps {
  name: string;
  /** MLB players only — when present, tries the real MLB headshot CDN before any local fallback file (see mlbHeadshotUrl). Tennis players have no equivalent public photo source, so this stays undefined for them. */
  mlbPersonId?: number;
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
 * wiring used everywhere a tennis player is shown; MLB players additionally
 * get a real photo from MLB's own CDN when mlbPersonId is supplied.
 */
export function PlayerBadge({ name, mlbPersonId, size }: PlayerBadgeProps) {
  const sources = mlbPersonId !== undefined ? [mlbHeadshotUrl(mlbPersonId), ...playerLogoSources(name)] : playerLogoSources(name);
  return <Logo sources={sources} alt={name} fallbackText={initialsFor(name)} size={size} />;
}
