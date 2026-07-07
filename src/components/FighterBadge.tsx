import { Logo } from "./Logo";

interface FighterBadgeProps {
  name: string;
  /** Optional corner tint (UFC red/blue) — omit for a neutral badge. */
  color?: string;
  size?: number;
}

/** First-name/last-name initials (e.g. "Israel Adesanya" -> "IA"); single-word names take the first two letters. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0].slice(0, 2) || "?").toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Initials avatar for a UFC fighter. Cito has no fighter photo source, so —
 * unlike PlayerBadge — this never attempts an image fetch (empty `sources`
 * renders Logo's fallback badge directly), avoiding pointless 404s.
 */
export function FighterBadge({ name, color, size = 28 }: FighterBadgeProps) {
  return <Logo sources={[]} alt={name} fallbackText={initialsFor(name)} color={color} size={size} />;
}
