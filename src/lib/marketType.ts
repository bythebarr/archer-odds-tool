import type { MarketType } from "@/generated/prisma/client";

export function parseMarketType(value: string | null): MarketType | undefined {
  if (value === "h2h" || value === "spreads" || value === "totals") return value;
  return undefined;
}
