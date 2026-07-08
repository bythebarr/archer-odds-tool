import { prisma } from "@/lib/prisma";
import { validateFeedback } from "@/lib/feedback";

// Public endpoint backing the /support form. No auth (anyone can report a
// problem), but validated + length-capped so it can't be used to dump junk.
// Submissions persist to the Feedback table and are read from the token-gated
// inbox at /support/inbox — self-contained, no email/Discord needed to launch.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }

  const { category, message, email, context } = (body ?? {}) as Record<string, unknown>;
  const result = validateFeedback({
    category: String(category ?? ""),
    message: String(message ?? ""),
    email: email == null ? null : String(email),
    context: context == null ? null : String(context),
  });

  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 400 });
  }

  try {
    // Truncate the UA so a spoofed giant header can't bloat a row.
    const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 400) || null;
    await prisma.feedback.create({
      data: { ...result.value, userAgent },
    });
    return Response.json({ ok: true });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    console.error("[feedback] create failed", messageText);
    return Response.json({ ok: false, error: "Could not save that — please try again." }, { status: 503 });
  }
}
