"use client";

import { useState } from "react";
import { f1DriverHeadshotUrl, f1TeamLogoUrl } from "@/lib/logos";
import { FlagBadge } from "@/components/FlagBadge";

/**
 * An F1 driver's official headshot or a team's official logo, falling back to
 * the nationality flag when F1's media has no image for them.
 */
export function F1Avatar({
  kind,
  name,
  constructorId,
  flag,
  size = 28,
}: {
  kind: "driver" | "team";
  name: string;
  constructorId?: string;
  flag: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const src = kind === "driver" ? f1DriverHeadshotUrl(name) : constructorId ? f1TeamLogoUrl(constructorId) : null;
  if (!src || failed) return <FlagBadge flag={flag} title={name} size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote official headshots/logos, sized tiny; next/image config isn't worth it here.
    <img
      src={src}
      alt={name}
      title={name}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/10 ${kind === "driver" ? "bg-gradient-to-b from-muted to-muted/40 object-cover object-top" : "bg-white object-contain p-[3px]"}`}
      style={{ width: size, height: size }}
    />
  );
}
