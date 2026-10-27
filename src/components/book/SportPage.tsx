import type { ReactNode } from "react";
import { sportMetaByKey, type NavSport } from "@/lib/engine/sportsMeta";
import { LeagueMark } from "@/components/brand/LeagueMark";
import { SportCarousel } from "./SportCarousel";

/** When each parked sport comes back — the banner says it plainly instead of leaving a quiet, half-empty page. */
const RETURNS: Partial<Record<NavSport, string>> = {
  mlb: "Back for Opening Day in late March.",
  f1: "Back when the new season starts in March.",
  tennis: "Back for the Australian Open in January.",
  soccer: "Back for the next major tournament window.",
};

/** The shared shell for every sport page outside the team-league layout: switcher, header, offseason banner. */
export function SportPage({
  sport,
  title,
  description,
  width = "2xl",
  children,
}: {
  sport: NavSport;
  title?: string;
  description?: ReactNode;
  width?: "2xl" | "3xl";
  children: ReactNode;
}) {
  const meta = sportMetaByKey[sport];
  return (
    <div className={`mx-auto min-h-screen w-full min-w-0 ${width === "3xl" ? "max-w-3xl" : "max-w-2xl"} px-4 pb-10 pt-5 font-sans`}>
      <SportCarousel active={sport} />
      <div className="mt-5 flex items-center gap-2.5 text-foreground">
        <LeagueMark sport={sport} size={30} />
        <h1 className="font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight">{title ?? meta.label}</h1>
      </div>
      {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
      {meta.parked && (
        <div className="relative mt-4 overflow-hidden rounded-2xl bg-[#07080b] px-4 py-3.5 text-[#eef0f4] ring-1 ring-white/10">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8f53a]">
            <span className="brand-slash" aria-hidden />
            Offseason
          </p>
          <p className="mt-1 text-sm">
            {RETURNS[sport] ?? "Back when its season starts."}{" "}
            <span className="text-[#8a90a0]">Live lines and models are paused until then; below is the latest on file.</span>
          </p>
        </div>
      )}
      {children}
    </div>
  );
}
