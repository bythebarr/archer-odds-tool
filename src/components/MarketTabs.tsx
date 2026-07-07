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
    <div className="sticky top-0 z-10 bg-background py-1">
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
