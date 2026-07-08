import { countryOfPlayer, flagEmoji } from "@/lib/nationality";
import { PlayerBadge } from "./PlayerBadge";

/**
 * A tennis player's avatar: their nationality flag when we know their country
 * (the "face OR flag" idea — we have no photo source for tennis, so the flag is
 * the identity), otherwise the neutral initials badge. The flag emoji needs no
 * assets and reads instantly.
 */
export function TennisPlayerBadge({ name, size = 28 }: { name: string; size?: number }) {
  const country = countryOfPlayer(name);
  if (!country) return <PlayerBadge name={name} size={size} />;

  return (
    <span
      title={`${name}${country ? ` (${country})` : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.62 }}
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted leading-none ring-1 ring-black/10 dark:ring-white/10"
    >
      {flagEmoji(country)}
    </span>
  );
}
