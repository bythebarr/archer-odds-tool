import { ArchrMark } from "@/components/brand/ArchrMark";

// The ARCHR mark for the quieter moments (404, error, empty states), so the
// launch animation's arrowhead carries through the whole app. Pure SVG, safe
// in Server Components.
//
// arrow:
//   "bullseye" — the mark in full color (a hit)
//   "miss"     — the mark muted and knocked off its line (a near miss)
//   "none"     — the mark muted
export function TargetMark({
  size = 112,
  arrow = "none",
}: {
  size?: number;
  arrow?: "bullseye" | "miss" | "none";
}) {
  const tone =
    arrow === "bullseye"
      ? "text-foreground dark:text-brand"
      : arrow === "miss"
        ? "rotate-[24deg] text-muted-foreground/40"
        : "text-muted-foreground/40";
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }} aria-hidden>
      {arrow === "bullseye" && <span className="absolute inset-[18%] rounded-full bg-brand/25 blur-2xl" />}
      <ArchrMark className={`relative w-[78%] ${tone}`} />
    </span>
  );
}
