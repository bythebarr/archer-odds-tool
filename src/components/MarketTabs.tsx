import type { MarketType } from "@/generated/prisma/client";

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
    <div className="sticky top-0 z-10 flex gap-2 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`px-3 py-2 text-sm font-medium ${
            market === tab.key
              ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
