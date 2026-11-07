/** Returns a 401 Response if the request's bearer token doesn't match CRON_SECRET, else null. */
import { tokenMatches } from "./tokenAuth";

export function checkCronAuth(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!tokenMatches(bearer, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
