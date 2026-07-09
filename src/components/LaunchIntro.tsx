"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * The app's opening moment: an arrow flies in and strikes the bullseye of the
 * archer target, which rings out and dissolves into the app. Plays once per
 * browser session (sessionStorage-gated) so it's a launch beat, not a per-nav
 * interruption. Lives in the root layout, which persists across client
 * navigations, so its effect runs once per hard load. Tap to skip; respects
 * prefers-reduced-motion.
 */
const TOTAL_MS = 2000;

export function LaunchIntro() {
  // Already played this session? Read via an external store so the check is
  // SSR-safe without a setState-in-effect. Server snapshot = "played" → nothing
  // renders during SSR, which also kills the brief replay flash on refresh.
  const alreadyPlayed = useSyncExternalStore(
    () => () => {},
    () => sessionStorage.getItem("archer:intro") === "1",
    () => true
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (alreadyPlayed) return;
    sessionStorage.setItem("archer:intro", "1");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => setDismissed(true), reduce ? 350 : TOTAL_MS);
    return () => clearTimeout(t);
  }, [alreadyPlayed]);

  if (alreadyPlayed || dismissed) return null;

  return (
    <div
      onClick={() => setDismissed(true)}
      style={{ backgroundColor: "var(--background, #0a0e17)" }}
      className="archer-intro fixed inset-0 z-[100] flex flex-col items-center justify-center"
      role="presentation"
    >
      <div className="relative grid place-items-center">
        <svg width="132" height="132" viewBox="0 0 132 132" className="overflow-visible">
          {/* Target rings */}
          <g className="ai-target" style={{ transformOrigin: "66px 66px" }}>
            <circle cx="66" cy="66" r="52" className="fill-none stroke-border" strokeWidth="6" />
            <circle cx="66" cy="66" r="36" className="fill-none stroke-muted-foreground" strokeWidth="6" opacity="0.5" />
            <circle cx="66" cy="66" r="20" className="fill-none stroke-primary" strokeWidth="6" />
            <circle cx="66" cy="66" r="6" className="fill-primary" />
          </g>
          {/* Shockwave ring on impact */}
          <circle
            cx="66"
            cy="66"
            r="20"
            className="ai-shock fill-none stroke-primary"
            strokeWidth="3"
            style={{ transformOrigin: "66px 66px" }}
          />
          {/* Arrow: shaft + head, flies in from the left to the bullseye */}
          <g className="ai-arrow" style={{ transformOrigin: "66px 66px" }}>
            <line x1="10" y1="66" x2="60" y2="66" className="stroke-primary" strokeWidth="3" strokeLinecap="round" />
            <path d="M58 60 L70 66 L58 72 Z" className="fill-primary" />
            <path d="M12 60 L4 66 L12 72" className="fill-none stroke-primary" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </svg>
      </div>
      <div className="ai-word mt-6 font-mono text-2xl font-bold tracking-[0.15em] text-foreground">
        ARCHR<span className="ai-edge ml-2 font-normal tracking-normal text-muted-foreground">Edge</span>
      </div>

      <style>{`
        @keyframes ai-fly {
          0% { transform: translateX(-62vw); opacity: 0; }
          12% { opacity: 1; }
          34%, 100% { transform: translateX(0); opacity: 1; }
        }
        @keyframes ai-hit {
          0%, 30% { transform: scale(1); }
          40% { transform: scale(1.14); }
          52% { transform: scale(0.98); }
          62%, 100% { transform: scale(1); }
        }
        @keyframes ai-shock {
          0%, 32% { transform: scale(0.55); opacity: 0; }
          40% { opacity: 0.8; }
          100% { transform: scale(3.4); opacity: 0; }
        }
        @keyframes ai-word {
          0%, 38% { opacity: 0; transform: translateY(6px); }
          52%, 100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes ai-edge {
          0%, 56% { opacity: 0; transform: translateX(-9px); }
          70%, 100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes ai-out {
          0%, 88% { opacity: 1; }
          100% { opacity: 0; }
        }
        .archer-intro { animation: ai-out ${TOTAL_MS}ms ease-in forwards; }
        .ai-arrow  { animation: ai-fly ${TOTAL_MS}ms cubic-bezier(.5,0,.25,1) forwards; }
        .ai-target { animation: ai-hit ${TOTAL_MS}ms ease-out forwards; }
        .ai-shock  { animation: ai-shock ${TOTAL_MS}ms ease-out forwards; }
        .ai-word   { animation: ai-word ${TOTAL_MS}ms ease-out forwards; }
        .ai-edge   { display: inline-block; animation: ai-edge ${TOTAL_MS}ms ease-out forwards; }
        @media (prefers-reduced-motion: reduce) {
          .archer-intro, .ai-arrow, .ai-target, .ai-shock, .ai-word, .ai-edge { animation: none; }
          .ai-arrow, .ai-shock { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
