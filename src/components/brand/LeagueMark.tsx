import { Glyph } from "@/components/brand/Glyph";
import { LEAGUE_LOGOS } from "@/lib/logos";
import type { ComponentProps } from "react";

/**
 * A league's official mark where we bundle one (public/logos/leagues), else
 * ARCHR's own sport glyph. The World Cup mark is black-on-transparent, so it
 * sits on a white tile to read in dark mode.
 */
export function LeagueMark({ sport, size = 28 }: { sport: ComponentProps<typeof Glyph>["name"]; size?: number }) {
  const src = LEAGUE_LOGOS[sport];
  if (!src) return <Glyph name={sport} className={size >= 28 ? "size-7 shrink-0" : "size-5 shrink-0"} />;
  const tile = sport === "soccer";
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a tiny bundled static mark; next/image adds nothing here.
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 object-contain ${tile ? "rounded-md bg-white p-0.5" : ""}`}
      style={{ width: size, height: size }}
    />
  );
}
