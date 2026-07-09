// Shared feedback vocabulary + validation, used by both the /api/feedback route
// and the /support form so the category set can't drift between them.
export const FEEDBACK_CATEGORIES = [
  { value: "data", label: "Missing or stale data" },
  { value: "bug", label: "Something's broken" },
  { value: "billing", label: "Billing or subscription" },
  { value: "account", label: "My account" },
  { value: "feature", label: "Feature request" },
  { value: "other", label: "Something else" },
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]["value"];

export const MESSAGE_MAX = 4000;
export const EMAIL_MAX = 254;
export const CONTEXT_MAX = 80;

const VALID: Set<string> = new Set(FEEDBACK_CATEGORIES.map((c) => c.value));

export interface FeedbackInput {
  category: string;
  message: string;
  email?: string | null;
  context?: string | null;
}

export type FeedbackValidation =
  | { ok: true; value: { category: FeedbackCategory; message: string; email: string | null; context: string | null } }
  | { ok: false; error: string };

/** Loose email sanity check — we only need "looks like an address", not RFC-perfect. */
function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function validateFeedback(input: FeedbackInput): FeedbackValidation {
  const category = String(input.category ?? "").trim();
  if (!VALID.has(category)) return { ok: false, error: "Pick a category." };

  const message = String(input.message ?? "").trim();
  if (message.length < 3) return { ok: false, error: "Add a little more detail." };
  if (message.length > MESSAGE_MAX) return { ok: false, error: "That message is too long." };

  let email: string | null = null;
  if (input.email != null && String(input.email).trim() !== "") {
    const e = String(input.email).trim();
    if (e.length > EMAIL_MAX || !looksLikeEmail(e)) return { ok: false, error: "That email doesn't look right." };
    email = e;
  }

  const context = input.context != null ? String(input.context).trim().slice(0, CONTEXT_MAX) || null : null;

  return { ok: true, value: { category: category as FeedbackCategory, message, email, context } };
}
