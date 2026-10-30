import type { ReactNode } from "react";
import { sportMetaByKey, type NavSport } from "@/lib/engine/sportsMeta";
import { LeagueMark } from "@/components/brand/LeagueMark";
import { SportCarousel } from "./SportCarousel";

/** The shared shell for every sport page outside the team-league layout: switcher and header. */
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
  width?: "2xl" | "3xl" | "6xl";
  children: ReactNode;
}) {
  const meta = sportMetaByKey[sport];
  return (
    <div className={`mx-auto min-h-screen w-full min-w-0 ${width === "6xl" ? "max-w-6xl" : width === "3xl" ? "max-w-3xl" : "max-w-2xl"} px-4 pb-10 pt-5 font-sans`}>
      <SportCarousel active={sport} />
      <div className="mt-5 flex items-center gap-2.5 text-foreground">
        <LeagueMark sport={sport} size={30} />
        <h1 className="font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight">{title ?? meta.label}</h1>
      </div>
      {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
      {children}
    </div>
  );
}
