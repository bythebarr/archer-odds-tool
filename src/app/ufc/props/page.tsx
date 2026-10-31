import type { Metadata } from "next";
import { getUfcPropsSlate } from "@/lib/queries/ufcProps";
import { SportCarousel } from "@/components/book/SportCarousel";
import { LeagueHeader } from "@/components/book/LeaguePage";
import { SportTabs } from "@/components/book/SportTabs";
import { EmptyState } from "@/components/EmptyState";
import { UfcPropsFinder } from "@/components/ufc/UfcPropsFinder";
import { refreshOnView } from "@/lib/ops/refreshOnView";
import { PropsScreener, type ScreenerParams } from "@/components/screener/PropsScreener";
import { PropsViewToggle, wantsScreen } from "@/components/screener/PropsViewToggle";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "UFC fighter props — significant strikes, takedowns, knockdowns",
  description: "ARCHR's line on every fighter on the upcoming UFC cards, with each fighter's full metrics sheet.",
};

/** Every fighter on the upcoming cards, the same props layout as every sport. */
export default async function UfcPropsPage({ searchParams }: { searchParams: Promise<{ bout?: string } & ScreenerParams> }) {
  const params = await searchParams;
  const { bout } = params;
  const screen = wantsScreen(params);
  await refreshOnView([["ufc-history", 360]]);
  const slate = await getUfcPropsSlate();
  return (
    <div className={`mx-auto min-h-screen w-full min-w-0 px-4 pb-10 pt-5 font-sans ${screen ? "max-w-6xl" : "max-w-2xl"}`}>
      <SportCarousel active="ufc" />
      <LeagueHeader sport="ufc" />
      <div className="mt-3">
        <SportTabs
          tabs={[
            { label: "Fight Cards", href: "/ufc", active: false },
            { label: "Fighter Props", href: "/ufc/props", active: true },
            { label: "Results", href: "/ufc?tab=results", active: false },
          ]}
        />
      </div>
      <PropsViewToggle basePath="/ufc/props" screen={screen} />
      {screen && (
        <div className="mt-4">
          <PropsScreener params={params} basePath="/ufc/props" sport="ufc" keep={{ view: "screen" }} />
        </div>
      )}
      {screen ? null : slate.bouts.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="No upcoming fights">Fighter props show for every bout as soon as the card is announced.</EmptyState>
        </div>
      ) : (
        <UfcPropsFinder slate={slate} initialBout={bout ?? null} />
      )}
    </div>
  );
}
