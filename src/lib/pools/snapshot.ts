/**
 * Pre-built leg pools, stored in PoolSnapshot (see the schema note there).
 *
 * Why: the props screener and the parlay builder used to build their pools on
 * the request path, cached ten minutes. When an entry expired, every server
 * instance that got a request rebuilt the whole pool itself, and hundreds of
 * those builds at once (650+ active queries, 2026-11-10) stalled the database
 * and every page with it. Now:
 *
 *   - pages only READ chunk rows (one cheap query each, cached a minute);
 *   - a rebuild runs off the request path (/api/cron/warm-pools), and only
 *     after an atomic claim on the pool's meta row, so however many viewers or
 *     servers ask at once, one build runs;
 *   - a pool goes stale after POOL_STALE_MS; a page view then asks for a
 *     rebuild after its response (refreshStalePools), and the hourly tick
 *     rebuilds every pool too.
 */
import { after } from "next/server";
import { headers } from "next/headers";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** A pool older than this is rebuilt on the next view. */
export const POOL_STALE_MS = 10 * 60_000;
/** A claim older than this belongs to a build that died: free to take. Past the warm route's 60s limit. */
export const CLAIM_TTL_MS = 3 * 60_000;

/** Split rows into at most `max` chunks of `size` (rows past them are dropped, as the cache always did). */
export function chunkRows<T>(rows: T[], size: number, max: number): T[][] {
  return Array.from({ length: max }, (_, i) => rows.slice(i * size, (i + 1) * size));
}

/** Chunk keys under a pool: `${pool}:${part}:${i}`. */
export const chunkKey = (pool: string, part: string, i: number) => `${pool}:${part}:${i}`;

/**
 * Take the rebuild claim on a pool. True only for the one caller that got it:
 * the row is created if missing, and an existing claim is taken over only when
 * it's older than CLAIM_TTL_MS.
 */
export async function claimPool(pool: string): Promise<boolean> {
  const ttl = Math.round(CLAIM_TTL_MS / 1000);
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "PoolSnapshot" ("key", "data", "buildingSince") VALUES (${pool}, '[]'::jsonb, now())
    ON CONFLICT ("key") DO UPDATE SET "buildingSince" = now()
    WHERE "PoolSnapshot"."buildingSince" IS NULL OR "PoolSnapshot"."buildingSince" < now() - make_interval(secs => ${ttl})
    RETURNING "key"`;
  return rows.length > 0;
}

/**
 * Pages read each chunk through unstable_cache, which won't store an entry over
 * 2 MB (it keeps serving the old one). A chunk past this is flagged on the
 * meta row's error, so /api/status shows it before the screener goes stale.
 */
export const CHUNK_WARN_BYTES = 1.5 * 1024 * 1024;

/**
 * A chunk's size as Next measures it against the 2 MB cap: unstable_cache stores
 * `{ data: { body: JSON.stringify(rows) } }` and checks JSON.stringify of THAT, so
 * every quote in the rows is escaped again and counts twice.
 */
export function cacheEntrySize(rows: unknown): number {
  return JSON.stringify({ kind: "FETCH", data: { headers: {}, body: JSON.stringify(rows), status: 200, url: "" }, revalidate: 60 }).length;
}

/** The chunks too big for a cache entry, as "main:0 2.10 MB". */
export function oversizeChunks(parts: Record<string, unknown[][]>, limit = CHUNK_WARN_BYTES): string[] {
  return Object.entries(parts).flatMap(([part, chunks]) =>
    chunks.flatMap((data, i) => {
      const bytes = cacheEntrySize(data);
      return bytes > limit ? [`${part}:${i} ${(bytes / 1_048_576).toFixed(2)} MB`] : [];
    })
  );
}

/** Store a finished build: every chunk row, then stamp the meta row built and release the claim. */
export async function writePool(pool: string, parts: Record<string, unknown[][]>): Promise<number> {
  let total = 0;
  const oversize = oversizeChunks(parts);
  const writes = Object.entries(parts).flatMap(([part, chunks]) =>
    chunks.map((data, i) => {
      total += data.length;
      const key = chunkKey(pool, part, i);
      const json = data as unknown as Prisma.InputJsonValue;
      return prisma.poolSnapshot.upsert({ where: { key }, create: { key, data: json, rows: data.length, builtAt: new Date() }, update: { data: json, rows: data.length, builtAt: new Date() } });
    })
  );
  await prisma.$transaction([
    ...writes,
    prisma.poolSnapshot.update({
      where: { key: pool },
      data: { builtAt: new Date(), buildingSince: null, rows: total, error: oversize.length ? `built, but too big for the 2 MB read cache (pages may keep an old slate): ${oversize.join(", ")}` : null },
    }),
  ]);
  return total;
}

/** Release a claim after a failed build, keeping the last good data and noting why. */
export async function failPool(pool: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.poolSnapshot.update({ where: { key: pool }, data: { buildingSince: null, error: message.slice(0, 500) } }).catch(() => undefined);
}

/** One chunk's rows; empty when it hasn't been built yet. */
export async function readChunk<T>(key: string): Promise<T[]> {
  const row = await prisma.poolSnapshot.findUnique({ where: { key }, select: { data: true } });
  return Array.isArray(row?.data) ? (row.data as T[]) : [];
}

/** Whether a pool needs a rebuild: never built, or built more than POOL_STALE_MS ago, and no live claim on it. */
export function isStale(meta: { builtAt: Date | null; buildingSince: Date | null } | undefined, now = Date.now()): boolean {
  if (meta?.buildingSince && now - meta.buildingSince.getTime() < CLAIM_TTL_MS) return false;
  return !meta?.builtAt || now - meta.builtAt.getTime() > POOL_STALE_MS;
}

/**
 * After the response, ask for a rebuild of each of these pools that's stale.
 * Each ask is its own function call to the warm route, which claims before
 * building, so a burst of viewers costs one build. Best effort: outside a
 * request (scripts, tests) or without CRON_SECRET it does nothing.
 */
export async function refreshStalePools(pools: string[]): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !pools.length) return;
  let origin: string;
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return;
    origin = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  } catch {
    return;
  }
  after(async () => {
    try {
      const metas = await prisma.poolSnapshot.findMany({ where: { key: { in: pools } }, select: { key: true, builtAt: true, buildingSince: true } });
      const byKey = new Map(metas.map((m) => [m.key, m]));
      await Promise.all(
        pools
          .filter((p) => isStale(byKey.get(p)))
          .map((p) =>
            fetch(`${origin}/api/cron/warm-pools?pool=${encodeURIComponent(p)}`, {
              headers: { authorization: `Bearer ${secret}` },
              signal: AbortSignal.timeout(55_000),
            }).catch(() => null)
          )
      );
    } catch {
      // Best effort: the hourly tick rebuilds every pool too.
    }
  });
}
