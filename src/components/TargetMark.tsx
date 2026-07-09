// The brand archery target as a static mark — the same ring stack and colors
// as the LaunchIntro's opening animation, so the motif people love on launch
// carries through to the quieter moments (404, error). Theme-aware via
// currentColor-style Tailwind stroke tokens. Pure SVG, safe in Server
// Components.
//
// arrow:
//   "bullseye" — arrow struck dead center (a hit)
//   "miss"     — arrow lodged high-and-right in the outer ring (a near miss)
//   "none"     — target only
export function TargetMark({
  size = 112,
  arrow = "none",
}: {
  size?: number;
  arrow?: "bullseye" | "miss" | "none";
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 132 132"
      className="overflow-visible"
      role="img"
      aria-hidden="true"
    >
      {/* Target rings — outer to bullseye. */}
      <circle cx="66" cy="66" r="52" className="fill-none stroke-border" strokeWidth="6" />
      <circle cx="66" cy="66" r="36" className="fill-none stroke-muted-foreground" strokeWidth="6" opacity="0.5" />
      <circle cx="66" cy="66" r="20" className="fill-none stroke-primary" strokeWidth="6" />
      <circle cx="66" cy="66" r="6" className="fill-primary" />

      {arrow === "bullseye" && (
        <g>
          <line x1="10" y1="66" x2="60" y2="66" className="stroke-primary" strokeWidth="3" strokeLinecap="round" />
          <path d="M58 60 L70 66 L58 72 Z" className="fill-primary" />
          <path
            d="M12 60 L4 66 L12 72"
            className="fill-none stroke-primary"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}

      {arrow === "miss" && (
        // Lodged in the upper-right outer ring, pointing down-left at the
        // bullseye but stopping short — a shot that just missed the mark. Kept
        // entirely in the upper-right quadrant so it never crosses the center
        // (which would read as a hit).
        <g className="stroke-muted-foreground" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="126" y1="6" x2="96" y2="36" />
          <path d="M92 40 L104 37 L99 27 Z" className="fill-muted-foreground stroke-none" />
          <path d="M120 4 L126 6 L124 12" className="fill-none" />
        </g>
      )}
    </svg>
  );
}
