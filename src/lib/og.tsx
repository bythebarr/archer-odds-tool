import { ImageResponse } from "next/og";

// Shared social-share card, used by both the Open Graph and Twitter image
// routes so a shared ARCHR link renders one branded 1200×630 card everywhere.
// Rendered by satori (next/og): flexbox + absolute positioning + transforms
// only — no CSS grid. Colors mirror the app's dark theme (globals.css) and the
// launch-intro target so the card, the app icon, and the opening animation all
// read as one system.
export const ogSize = { width: 1200, height: 630 };
export const ogContentType = "image/png";

const BG = "#0a0e17";
const INK = "#e6edf5";
const MUTED = "#7c8aa0";
const RING = "#2b3852";
const CYAN = "#38bdf8";

/** One concentric target ring, centered in its relative parent. */
function ring(diameter: number, borderWidth: number, color: string) {
  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: diameter,
        height: diameter,
        borderRadius: "50%",
        border: `${borderWidth}px solid ${color}`,
        display: "flex",
      }}
    />
  );
}

export function OgImage(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BG,
          color: INK,
          fontFamily: "sans-serif",
        }}
      >
        {/* Top accent bar — the app's primary cyan. */}
        <div style={{ display: "flex", height: 12, width: "100%", background: CYAN }} />

        {/* Main: target motif + wordmark. */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            gap: 64,
            padding: "0 84px",
          }}
        >
          {/* Archery target with an arrow struck into the bullseye. */}
          <div style={{ position: "relative", width: 260, height: 260, display: "flex" }}>
            {ring(260, 18, RING)}
            {ring(188, 18, MUTED)}
            {ring(116, 18, CYAN)}
            {/* Bullseye */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: CYAN,
                display: "flex",
              }}
            />
            {/* Arrow shaft, flying in from the left into the bullseye. */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: -70,
                transform: "translateY(-50%)",
                width: 210,
                height: 8,
                borderRadius: 4,
                background: INK,
                display: "flex",
              }}
            />
            {/* Arrowhead chevron at the bullseye. */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: 118,
                transform: "translate(-50%, -50%) rotate(45deg)",
                width: 30,
                height: 30,
                borderTop: `8px solid ${INK}`,
                borderRight: `8px solid ${INK}`,
                display: "flex",
              }}
            />
          </div>

          {/* Wordmark + tagline. */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <span style={{ fontSize: 104, fontWeight: 800, letterSpacing: "0.02em" }}>ARCHR</span>
              <span style={{ fontSize: 104, fontWeight: 400, color: MUTED, marginLeft: 20 }}>Edge</span>
            </div>
            <div style={{ display: "flex", marginTop: 8, fontSize: 36, color: INK, maxWidth: 640 }}>
              Every sport, one board — model leans, hit-rates &amp; EV.
            </div>
          </div>
        </div>

        {/* Footer: the sport lineup + the honest disclaimer. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 84px 56px",
            fontSize: 26,
            color: MUTED,
          }}
        >
          <span style={{ letterSpacing: "0.12em" }}>MLB · UFC · F1 · TENNIS · SOCCER</span>
          <span>Research &amp; discovery only</span>
        </div>
      </div>
    ),
    ogSize
  );
}
