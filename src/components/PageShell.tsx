import type { ReactNode } from "react";

// Tailwind can't see interpolated class names, so map widths explicitly.
const WIDTHS = {
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
} as const;

/**
 * The standard page container — `mx-auto min-h-screen … px-4 py-10 font-sans`
 * was copy-pasted into every page. One place now owns the max-width/padding
 * rhythm; pass `width` for the two sizes in use and `className` for extras.
 */
export function PageShell({
  width = "2xl",
  className = "",
  children,
}: {
  width?: keyof typeof WIDTHS;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`mx-auto min-h-screen w-full min-w-0 ${WIDTHS[width]} px-4 py-10 font-sans ${className}`}>
      {children}
    </div>
  );
}

/**
 * The standard page header — an h1 with an optional right-aligned slot (a
 * cross-link or badge) and a muted description line beneath.
 */
export function PageHeader({
  title,
  description,
  right,
}: {
  title: string;
  description?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {right}
      </div>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </>
  );
}
