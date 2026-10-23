"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ArchrMark } from "@/components/brand/ArchrMark";

/**
 * The app's opening moment: the ARCHR mark streaks in along its own flight
 * line trailing volt speed lines, strikes center with a flash and shockwave,
 * and the wordmark snaps in beside the "EDGE" tag — then it all dissolves into
 * the app. Plays once per browser session (sessionStorage-gated) so it's a
 * launch beat, not a per-nav interruption. Lives in the root layout, which
 * persists across client navigations, so its effect runs once per hard load.
 * Tap to skip; respects prefers-reduced-motion. Always ink, whatever the theme.
 */
const TOTAL_MS = 2100;

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
      style={{ backgroundColor: "#07080b" }}
      className="archer-intro fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden"
      role="presentation"
    >
      <div className="relative grid place-items-center">
        {/* Speed lines trailing the mark's flight, down-left of center. */}
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="ai-streak absolute h-[3px] rounded-full bg-[#c8f53a]"
            style={{
              width: 120 - i * 28,
              right: "50%",
              top: `calc(50% + ${18 + i * 16}px)`,
              animationDelay: `${i * 40}ms`,
            }}
          />
        ))}
        <span className="ai-shock absolute size-28 rounded-full border-2 border-[#c8f53a]" />
        <ArchrMark className="ai-mark relative h-28 w-auto text-white" />
      </div>
      <div className="ai-word mt-7 flex items-center gap-2.5 text-[#eef0f4]">
        <span className="font-display text-4xl font-extrabold italic leading-none tracking-[0.02em]">ARCHR</span>
        <span className="ai-edge brand-tag font-display text-sm font-bold italic leading-none tracking-[0.16em] py-1.5">
          EDGE
        </span>
      </div>

      <style>{`
        @keyframes ai-fly {
          0% { transform: translate(-70vw, 55vh) rotate(-8deg) scale(.7); opacity: 0; filter: blur(6px); }
          10% { opacity: 1; }
          30% { transform: translate(0, 0) rotate(0) scale(1.08); filter: blur(0); color: #c8f53a; }
          40% { transform: scale(.97); }
          52%, 100% { transform: scale(1); color: #ffffff; }
        }
        @keyframes ai-streak {
          0% { transform: translate(-60vw, 45vh) rotate(-38deg); opacity: 0; }
          12% { opacity: .9; }
          30% { transform: translate(-30px, 10px) rotate(-38deg); opacity: .9; }
          44%, 100% { transform: translate(-30px, 10px) rotate(-38deg) scaleX(0); opacity: 0; }
        }
        @keyframes ai-shock {
          0%, 28% { transform: scale(.4); opacity: 0; }
          34% { opacity: .9; }
          70%, 100% { transform: scale(2.8); opacity: 0; }
        }
        @keyframes ai-word {
          0%, 40% { opacity: 0; transform: translateX(-14px) skewX(-8deg); }
          56%, 100% { opacity: 1; transform: translateX(0) skewX(0); }
        }
        @keyframes ai-edge {
          0%, 54% { opacity: 0; transform: translateX(16px) scale(.8); }
          64% { opacity: 1; transform: translateX(-2px) scale(1.06); }
          72%, 100% { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes ai-out {
          0%, 86% { opacity: 1; }
          100% { opacity: 0; }
        }
        .archer-intro { animation: ai-out ${TOTAL_MS}ms ease-in forwards; }
        .ai-mark   { animation: ai-fly ${TOTAL_MS}ms cubic-bezier(.55,0,.2,1) forwards; }
        .ai-streak { transform-origin: right center; animation: ai-streak ${TOTAL_MS}ms cubic-bezier(.55,0,.2,1) both; }
        .ai-shock  { animation: ai-shock ${TOTAL_MS}ms ease-out forwards; }
        .ai-word   { animation: ai-word ${TOTAL_MS}ms cubic-bezier(.2,.8,.2,1) forwards; }
        .ai-edge   { animation: ai-edge ${TOTAL_MS}ms ease-out forwards; }
        @media (prefers-reduced-motion: reduce) {
          .archer-intro, .ai-mark, .ai-streak, .ai-shock, .ai-word, .ai-edge { animation: none; }
          .ai-streak, .ai-shock { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
