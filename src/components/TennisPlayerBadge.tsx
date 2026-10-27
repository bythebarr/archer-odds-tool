"use client";

import { useState } from "react";
import { countryOfPlayer, flagEmoji } from "@/lib/nationality";
import { FlagBadge } from "./FlagBadge";
import { PlayerBadge } from "./PlayerBadge";

/**
 * A tennis player's avatar: their photo (see /api/headshot/tennis), else their
 * nationality flag, else the initials badge.
 */
export function TennisPlayerBadge({ name, size = 28 }: { name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const country = countryOfPlayer(name);
  const fallback = country ? <FlagBadge flag={flagEmoji(country)} title={`${name} (${country})`} size={size} /> : <PlayerBadge name={name} size={size} />;
  if (failed) return fallback;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a redirect to a remote photo; next/image can't follow it.
    <img
      src={`/api/headshot/tennis?name=${encodeURIComponent(name)}`}
      alt={name}
      title={name}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full bg-muted object-cover object-top ring-1 ring-black/10 dark:ring-white/10"
      style={{ width: size, height: size }}
    />
  );
}
