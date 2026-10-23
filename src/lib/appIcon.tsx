import { BRAND } from "@/lib/brand/colors";
import { MARK_PATH, MARK_VIEWBOX } from "@/lib/brand/mark";

/**
 * The app icon: the volt ARCHR mark on an ink tile. Sized by the caller's
 * ImageResponse config — the mark is a percentage of the tile, so one tree
 * covers 32px favicons through 512px home-screen icons.
 */
export function AppIconMark() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BRAND.ink,
        borderRadius: "22%",
      }}
    >
      <svg viewBox={MARK_VIEWBOX} width="74%" height="74%">
        <path fill={BRAND.volt} fillRule="evenodd" d={MARK_PATH} />
      </svg>
    </div>
  );
}
