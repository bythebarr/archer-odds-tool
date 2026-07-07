import type { MarketType } from "@/generated/prisma/client";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS: { key: MarketType; label: string }[] = [
  { key: "h2h", label: "Moneyline" },
  { key: "spreads", label: "Spread" },
  { key: "totals", label: "Total" },
];

interface MarketTabsProps {
  market: MarketType;
  onChange: (market: MarketType) => void;
}

/** Sticky Moneyline/Spread/Total tab bar shared by every market-scoped view. */
export function MarketTabs({ market, onChange }: MarketTabsProps) {
  return (
    // top-[57px] clears the sticky SiteNav (~57px tall, z-20) so the tab bar
    // doesn't slide underneath and vanish on scroll.
    <div className="sticky top-[57px] z-10 bg-background py-1">
      <Tabs value={market} onValueChange={(v) => onChange(v as MarketType)}>
        <TabsList variant="line">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
