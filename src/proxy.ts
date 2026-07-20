import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Private-edge gate. When SITE_ACCESS_PASSWORD is set, the whole site sits
 * behind HTTP Basic Auth so only you can view it — the tool is your private
 * edge feeding the Discord, not a free public site. Unset = pass-through
 * (public, exactly as before), so nothing breaks until you set the env var in
 * Vercel prod. Any username works; only the password is checked.
 *
 * Next 16 proxy convention (src/proxy.ts, Node.js runtime) — not middleware.ts.
 *
 * API routes are deliberately NOT gated (see matcher): /api/cron/* carry their
 * own CRON_SECRET auth and Vercel's cron can't send Basic Auth, so gating them
 * would break the pollers and the Discord poster.
 */
export function proxy(request: NextRequest) {
  // Legal pages stay public even when the rest of the site is gated — Discord
  // app verification, Whop, and members all need to reach them.
  const path = request.nextUrl.pathname;
  if (path === "/terms" || path === "/privacy") return NextResponse.next();

  // The deck carries its OWN secret (?token=CRON_SECRET) and 404s without it, so
  // Basic Auth on top adds a second password without adding protection — and it
  // has to be typed on a phone, at the exact moment the card needs making. One
  // gate, not two.
  if (path === "/deck") return NextResponse.next();

  const password = process.env.SITE_ACCESS_PASSWORD;
  if (!password) return NextResponse.next(); // gate dormant until the env var is set

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const supplied = decoded.slice(decoded.indexOf(":") + 1); // password half of user:pass
    if (supplied === password) return NextResponse.next();
  }

  // NB: header values must be ASCII/Latin1 — no em dash or other >255 chars here.
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ARCHR", charset="UTF-8"' },
  });
}

export const config = {
  // Gate page navigations; skip Next internals, static assets, and ALL /api
  // routes (crons + the poster must keep working without Basic Auth).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:ico|png|jpg|jpeg|gif|svg|webp|css|js|woff|woff2|ttf|map)$).*)",
  ],
};
