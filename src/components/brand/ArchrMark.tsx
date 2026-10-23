import { MARK_PATH, MARK_VIEWBOX } from "@/lib/brand/mark";

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
      <path fill="currentColor" fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}
