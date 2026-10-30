"use client";

import type { ReactNode } from "react";

/** A GET form that applies itself whenever a filter changes (and still works with the Apply button, no JS). */
export function AutoSubmitForm({ action, children, className }: { action: string; children: ReactNode; className?: string }) {
  return (
    <form action={action} method="get" className={className} onChange={(e) => e.currentTarget.requestSubmit()}>
      {children}
    </form>
  );
}
