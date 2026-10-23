import { MARK_PATH, MARK_VIEWBOX } from "@/lib/brand/mark";

const SYMBOL_ID = "archr-mark";

/**
 * The mark's path, defined once per page (in the root layout). Every ArchrMark
 * references it, so a page that shows the mark in the header, nav and banner
 * carries the ~9KB path once instead of once per use.
 */
export function ArchrMarkSymbol() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <symbol id={SYMBOL_ID} viewBox={MARK_VIEWBOX}>
        <path fill="currentColor" fillRule="evenodd" d={MARK_PATH} />
      </symbol>
    </svg>
  );
}

/** The ARCHR arrowhead mark. Inherits `currentColor`; size it with height/width classes. */
export function ArchrMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <use href={`#${SYMBOL_ID}`} />
    </svg>
  );
}
