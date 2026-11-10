import { checkCronAuth } from "@/lib/cronAuth";
import { claimPool, failPool, writePool } from "@/lib/pools/snapshot";
import { POOLS, POOL_KEYS } from "@/lib/pools/registry";

/**
 * Rebuilds the pre-built leg pools (lib/pools/snapshot).
 *
 *   ?pool=<key>  build that one pool, if this call wins its claim (a burst of
 *                asks for one pool costs one build; the rest answer "busy").
 *   (no pool)    the tick's job: ask for every pool, each as its own call.
 */
export const maxDuration = 60;

const DEADLINE_MS = 55_000;

export async function GET(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const url = new URL(request.url);
  const pool = url.searchParams.get("pool");

  if (pool) {
    const build = POOLS[pool];
    if (!build) return Response.json({ error: `unknown pool ${pool}` }, { status: 400 });
    if (!(await claimPool(pool))) return Response.json({ pool, status: "busy: another build holds the claim" });
    const t = Date.now();
    try {
      const rows = await writePool(pool, await build());
      return Response.json({ pool, status: "built", rows, seconds: (Date.now() - t) / 1000 });
    } catch (error) {
      await failPool(pool, error);
      return Response.json({ pool, status: "failed", error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }

  // Fan out: each pool in its own function call, on the production domain (see the tick).
  const prodHost = process.env.VERCEL_ENV === "production" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : undefined;
  const origin = prodHost ? `https://${prodHost}` : url.origin;
  const ran = await Promise.all(
    POOL_KEYS.map(async (key) => {
      try {
        const res = await fetch(`${origin}/api/cron/warm-pools?pool=${encodeURIComponent(key)}`, {
          headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
          redirect: "manual",
          signal: AbortSignal.timeout(DEADLINE_MS),
        });
        const body = (res.headers.get("content-type") ?? "").includes("application/json") ? await res.json() : { status: `${res.status}` };
        return { pool: key, ...body };
      } catch (error) {
        return { pool: key, status: error instanceof Error && error.name === "TimeoutError" ? "still running at the deadline" : String(error) };
      }
    })
  );
  return Response.json({ ran });
}

export async function POST(request: Request) {
  return GET(request);
}
