import { Logo } from "./Logo";

interface FighterBadgeProps {
  name: string;
  /** Cito UFC.com headshot URL when we have one; falls back to an initials badge otherwise. */
  imageUrl?: string | null;
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
 * Avatar for a UFC fighter — a real headshot from Cito's UFC.com CDN when
 * available (ingested onto UfcFighter.imageUrl), otherwise a neutral initials
 * badge. Older fighters with no photo on file just render the fallback.
 */
export function FighterBadge({ name, imageUrl, color, size = 28 }: FighterBadgeProps) {
  return <Logo sources={imageUrl ? [imageUrl] : []} alt={name} fallbackText={initialsFor(name)} color={color} size={size} />;
}
