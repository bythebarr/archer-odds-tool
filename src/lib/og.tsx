import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand/colors";
import { MARK_PATH, MARK_VIEWBOX } from "@/lib/brand/mark";

// Shared social-share card, used by both the Open Graph and Twitter image
// routes so a shared ARCHR link renders one branded 1200×630 card everywhere.
// Rendered by satori (next/og): flexbox + absolute positioning + transforms
// only — no CSS grid. Same system as the app icon and the lobby banner: ink
// ground, the mark flying off the edge, volt for the one loud word.
export const ogSize = { width: 1200, height: 630 };
export const ogContentType = "image/png";

/** Saira ExtraBold Italic (SIL OFL), the app's display face, bundled for satori. */
const DISPLAY_FONT = join(process.cwd(), "src/lib/brand/fonts/Saira-ExtraBoldItalic.ttf");

export async function OgImage(): Promise<ImageResponse> {
  const saira = await readFile(DISPLAY_FONT);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: BRAND.ink,
          color: "#eef0f4",
          fontFamily: "sans-serif",
          overflow: "hidden",
        }}
      >
        {/* The mark, oversized and flying off the right edge. */}
        <svg
          viewBox={MARK_VIEWBOX}
          width={640}
          height={608}
          style={{ position: "absolute", right: -90, top: 40, opacity: 0.95 }}
        >
          <path fill={BRAND.volt} fillRule="evenodd" d={MARK_PATH} />
        </svg>

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 84px", width: 720 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <span style={{ fontFamily: "Saira", fontSize: 46, letterSpacing: "0.02em" }}>ARCHR</span>
            <span
              style={{
                display: "flex",
                background: BRAND.volt,
                color: BRAND.ink,
                fontFamily: "Saira",
                fontSize: 22,
                letterSpacing: "0.16em",
                padding: "6px 16px",
                transform: "skewX(-14deg)",
              }}
            >
              EDGE
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 34, fontFamily: "Saira", fontSize: 104, lineHeight: 0.95 }}>
            <span>BEST LINE.</span>
            <span style={{ color: BRAND.volt }}>EVERY BOOK.</span>
          </div>
          <div style={{ display: "flex", marginTop: 30, fontSize: 30, color: BRAND.muted }}>
            NBA · NFL · UFC — every price, side by side.
          </div>
        </div>
      </div>
    ),
    { ...ogSize, fonts: [{ name: "Saira", data: saira, weight: 800, style: "italic" }] }
  );
}
