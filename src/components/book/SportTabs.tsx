import Link from "next/link";

/** Underlined section tabs under a sport or game header (Game Lines · Player Props). */
export function SportTabs({ tabs }: { tabs: { label: string; href: string; active: boolean }[] }) {
  return (
    <div className="-mx-4 border-b border-border px-4">
      <nav className="flex gap-6" aria-label="Sections">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.active ? "page" : undefined}
            className={`-mb-px border-b-[3px] pb-2.5 pt-1 text-sm font-semibold transition-colors ${
              t.active ? "border-foreground text-foreground dark:border-brand" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
