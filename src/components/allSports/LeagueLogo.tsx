import { flagForNation } from "@/lib/nationality";

const REGION_FLAG: Record<string, string> = {
  europe: "🇪🇺",
  international: "🌍",
  "south america": "🌎",
  "north america": "🌎",
  asia: "🌏",
  finland: "🇫🇮",
  russia: "🇷🇺",
  china: "🇨🇳",
  india: "🇮🇳",
  pakistan: "🇵🇰",
  "west indies": "🌴",
  uk: "🇬🇧",
  "south korea": "🇰🇷",
};

export function regionFlag(region: string | null): string | null {
  if (!region) return null;
  return REGION_FLAG[region.toLowerCase()] ?? flagForNation(region);
}

/** A league's own logo where ESPN has one, else its country's flag, else its initials — on a white tile so dark crests read on dark. */
export function LeagueLogo({ name, region, logoUrl, size = 28 }: { name: string; region: string | null; logoUrl: string | null; size?: number }) {
  const flag = regionFlag(region);
  return (
    <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-black/10" style={{ width: size, height: size }} aria-hidden>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- ESPN CDN logo, any league.
        <img src={logoUrl} alt="" width={size} height={size} loading="lazy" className="size-full object-contain p-0.5" />
      ) : flag ? (
        <span style={{ fontSize: size * 0.62 }}>{flag}</span>
      ) : (
        <span className="text-[10px] font-bold text-zinc-700">{name.slice(0, 3).toUpperCase()}</span>
      )}
    </span>
  );
}
