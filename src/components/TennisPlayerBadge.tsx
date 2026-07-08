import { countryOfPlayer, flagEmoji } from "@/lib/nationality";
import { FlagBadge } from "./FlagBadge";
import { PlayerBadge } from "./PlayerBadge";

/**
 * A tennis player's avatar: their nationality flag when we know their country
 * (the "face OR flag" idea — we have no photo source for tennis, so the flag is
 * the identity), otherwise the neutral initials badge.
 */
export function TennisPlayerBadge({ name, size = 28 }: { name: string; size?: number }) {
  const country = countryOfPlayer(name);
  if (!country) return <PlayerBadge name={name} size={size} />;
  return <FlagBadge flag={flagEmoji(country)} title={`${name} (${country})`} size={size} />;
}
