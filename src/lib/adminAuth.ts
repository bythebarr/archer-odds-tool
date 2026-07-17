/**
 * Shared auth gate for the `/api/admin/*` control-panel routes.
 *
 * These sit under `/api`, which the app proxy (proxy.ts) deliberately leaves
 * ungated so Vercel Cron and the Discord poster can reach `/api/cron/*` without
 * Basic Auth. The side effect was that the admin routes were also publicly
 * reachable on archrhub.com (an unauthenticated GET to e.g. reset-ledger or
 * fire-card would run). This closes that: every admin route requires the shared
 * owner secret.
 *
 * The secret is supplied as a `?token=` query param — so the owner can keep a
 * plain one-click bookmark (`…/api/admin/fire-card?token=SECRET`) — or as an
 * `Authorization: Bearer <secret>` header for curl/automation. It reuses
 * CRON_SECRET (already provisioned in prod) rather than a new env var: same
 * owner-only trust level, nothing extra to configure. Fails closed — if
 * CRON_SECRET isn't set the routes 500 rather than run open.
 */
export function checkAdminAuth(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("Admin auth is not configured (CRON_SECRET unset).", { status: 500 });
  }

  const token = new URL(request.url).searchParams.get("token");
  const header = request.headers.get("authorization");
  if (token === secret || header === `Bearer ${secret}`) return null;

  return new Response(
    "Unauthorized. Append ?token=<CRON_SECRET> to the URL (or send an Authorization: Bearer header).",
    { status: 401 }
  );
}
