import { ArchrMark } from "./ArchrMark";

/**
 * The app's icon set: one consistent line style (24px grid, 1.75 stroke) for
 * every sport and nav destination, in place of emoji. Home is the ARCHR mark.
 */
export type GlyphKey =
  | "home" | "props" | "nba" | "nfl" | "ufc" | "mlb" | "tennis" | "soccer" | "f1" | "cfb"
  | "hockey" | "cricket" | "table-tennis" | "esports" | "darts" | "boxing" | "rugby" | "volleyball"
  | "handball" | "snooker" | "golf" | "lacrosse" | "badminton" | "curling" | "cycling" | "all";

const PATHS: Record<Exclude<GlyphKey, "home">, React.ReactNode> = {
  nba: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3v18M5.7 5.7C8.2 8 9.5 10 9.5 12s-1.3 4-3.8 6.3M18.3 5.7C15.8 8 14.5 10 14.5 12s1.3 4 3.8 6.3" />
    </>
  ),
  nfl: (
    <>
      <ellipse cx="12" cy="12" rx="10" ry="5.6" transform="rotate(-45 12 12)" />
      <path d="M9 15l6-6M10.2 11.4l2.4 2.4M11.8 9.8l2.4 2.4M8.6 13l2.4 2.4" />
    </>
  ),
  cfb: (
    <>
      <ellipse cx="12" cy="12" rx="10" ry="5.6" transform="rotate(-45 12 12)" />
      <path d="M9 15l6-6M10.2 11.4l2.4 2.4M11.8 9.8l2.4 2.4" />
    </>
  ),
  // The octagon — the cage, not a glove.
  ufc: (
    <>
      <path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3Z" />
      <path d="M10 7.5h4l2.5 2.5v4L14 16.5h-4L7.5 14v-4Z" opacity=".55" />
    </>
  ),
  mlb: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M6.2 5.2c1.9 1.8 2.8 4.1 2.8 6.8s-.9 5-2.8 6.8M17.8 5.2C15.9 7 15 9.3 15 12s.9 5 2.8 6.8" />
    </>
  ),
  tennis: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M4.6 6.8C7.8 8 9.5 9.9 9.5 12s-1.7 4-4.9 5.2M19.4 6.8C16.2 8 14.5 9.9 14.5 12s1.7 4 4.9 5.2" />
    </>
  ),
  soccer: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8.2l3.6 2.6-1.4 4.2H9.8l-1.4-4.2ZM12 8.2V3.4M15.6 10.8l4.4-1.6M14.2 15l2.8 3.8M9.8 15 7 18.8M8.4 10.8 4 9.2" />
    </>
  ),
  f1: (
    <>
      <path d="M5 21V3.5" />
      <path d="M5 4h14v9H5" />
      <path d="M8.5 4v3H12V4M15.5 4v3H19M5 7h3.5M12 7h3.5v3H19M8.5 10H12v3M15.5 10v3M5 10h3.5" />
    </>
  ),
  hockey: (
    <>
      <path d="M5 3.5 11 17c.4.9 1.2 1.5 2.2 1.5H20" />
      <path d="M19 3.5 13.6 15.7" />
      <ellipse cx="7" cy="19.5" rx="3" ry="1.3" />
    </>
  ),
  cricket: (
    <>
      <path d="m4 20 9.5-9.5 2 2L6 22" />
      <path d="m13.5 10.5 5-5 2 2-5 5" />
      <circle cx="18" cy="18" r="2.2" />
    </>
  ),
  "table-tennis": (
    <>
      <circle cx="10" cy="10" r="6.2" />
      <path d="m14.4 14.4 5.6 5.6" />
      <circle cx="19" cy="5" r="1.6" />
    </>
  ),
  esports: (
    <>
      <path d="M7 8h10a4 4 0 0 1 4 4v2.5a2.5 2.5 0 0 1-4.5 1.5L15 14H9l-1.5 2A2.5 2.5 0 0 1 3 14.5V12a4 4 0 0 1 4-4Z" />
      <path d="M7.5 10.5v3M6 12h3M15.5 11.2h.01M17.5 12.8h.01" />
    </>
  ),
  darts: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <path d="M12 12 20 4M17 4h3v3" />
    </>
  ),
  boxing: (
    <>
      <path d="M7 11V8a5 5 0 0 1 10 0v5a4 4 0 0 1-4 4H9.5A3.5 3.5 0 0 1 6 13.5V12a1 1 0 0 1 1-1h3" />
      <path d="M8 17v3.5h8V17" />
    </>
  ),
  rugby: (
    <>
      <ellipse cx="12" cy="12" rx="9.5" ry="6" transform="rotate(-35 12 12)" />
      <path d="M6.6 16.4C9 13 13.5 9.5 17.4 7.6" />
    </>
  ),
  volleyball: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3c0 5 2.5 8.5 8 10M12 12c-4.5 2.5-6 6-5.5 8M12 12C8 9.5 4 9.8 3.2 10.5" />
    </>
  ),
  handball: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M4.5 7.5 12 12l7.5-4.5M12 12v9" />
    </>
  ),
  snooker: (
    <>
      <circle cx="9" cy="15" r="5" />
      <circle cx="9" cy="15" r="1.4" fill="currentColor" />
      <path d="M13.5 10.5 21 3" />
    </>
  ),
  golf: (
    <>
      <path d="M8 21V3l9 3.5L8 10" />
      <path d="M4 21h10" />
      <circle cx="17.5" cy="18" r="2" />
    </>
  ),
  lacrosse: (
    <>
      <path d="M4 20 13 11" />
      <path d="M13 11c-1.5-3 0-7 3.5-7.5 3.5-.5 4.5 2.5 3.5 5S16 12.5 13 11Z" />
      <path d="M14.5 6.5l3 3M16.5 5l1.5 1.5" />
    </>
  ),
  badminton: (
    <>
      <path d="M9 15 4 20" />
      <path d="m9 15 3-9 6 6Z" />
      <path d="m12 6 3 3M14.5 8.5l1.5 1.5" />
    </>
  ),
  curling: (
    <>
      <path d="M5 16a7 4 0 0 0 14 0v-1.5H5Z" />
      <path d="M8 14.5V12a4 4 0 0 1 8 0v2.5M12 8V5h4" />
    </>
  ),
  cycling: (
    <>
      <circle cx="6" cy="16" r="3.5" />
      <circle cx="18" cy="16" r="3.5" />
      <path d="M6 16 9.5 9h6L18 16M9.5 9 12 16h-6M14 6h2.5" />
    </>
  ),
  all: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  props: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </>
  ),
};

export function Glyph({ name, className = "size-6" }: { name: GlyphKey; className?: string }) {
  if (name === "home") return <ArchrMark className={className} />;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name] ?? PATHS.all}
    </svg>
  );
}
