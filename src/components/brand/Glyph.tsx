import { ArchrMark } from "./ArchrMark";

/**
 * The app's icon set: one consistent line style (24px grid, 1.75 stroke) for
 * every sport and nav destination, in place of emoji. Home is the ARCHR mark.
 */
export type GlyphKey = "home" | "props" | "nba" | "nfl" | "ufc" | "mlb" | "tennis" | "soccer" | "f1" | "cfb";

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
      {PATHS[name]}
    </svg>
  );
}
