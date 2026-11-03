"use client";

import Form from "next/form";
import type { ReactNode } from "react";

/**
 * A GET form that applies itself whenever a filter changes (and still works with
 * the Apply button, no JS). It navigates in place, keeping the scroll position,
 * rather than reloading the whole page.
 */
export function AutoSubmitForm({ action, children, className }: { action: string; children: ReactNode; className?: string }) {
  return (
    <Form action={action} scroll={false} replace className={className} onChange={(e) => e.currentTarget.requestSubmit()}>
      {children}
    </Form>
  );
}
