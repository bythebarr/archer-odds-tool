import { ArchrMark } from "./ArchrMark";

/**
 * Mark + "ARCHR" set in the display face, leaning with the arrow, and the
 * "EDGE" tag cut as a volt parallelogram — the same angle as the mark's flight.
 */
export function ArchrWordmark({ size = "md" }: { size?: "md" | "lg" }) {
  const lg = size === "lg";
  return (
    <span className="inline-flex items-center gap-2 text-foreground">
      <ArchrMark className={lg ? "h-10 w-auto" : "h-[22px] w-auto"} />
      <span
        className={`font-display font-extrabold italic leading-none tracking-[0.02em] ${lg ? "text-4xl" : "text-[19px]"}`}
      >
        ARCHR
      </span>
      <span
        className={`brand-tag font-display font-bold italic leading-none tracking-[0.14em] ${
          lg ? "px-2.5 py-1 text-sm" : "px-1.5 py-[3px] text-[10px]"
        }`}
      >
        EDGE
      </span>
    </span>
  );
}
