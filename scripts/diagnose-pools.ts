import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { POOLS, POOL_KEYS } from "@/lib/pools/registry";
import { CLAIM_TTL_MS, POOL_STALE_MS } from "@/lib/pools/snapshot";
import { etDateOf } from "@/lib/dateEt";

/**
 * Read-only: the pre-built leg pools as production stores them.
 *
 *   1. Each pool's meta row: when it was last built, whether a build holds
 *      its claim (and for how long), the last build error, and the rows it
 *      stored — plus the game dates inside its chunks (is the screener
 *      showing yesterday's slate?).
 *   2. Each pool's build, timed here with no deadline, so a build that can't
 *      finish inside the warm route's 60 s limit shows its real time. Nothing
 *      is written.
 *
 * Run from the Model lab (script: diagnose:pools).
 */
const age = (d: Date | null, now: number) => (d ? `${((now - d.getTime()) / 60_000).toFixed(0)} min ago (${d.toISOString().slice(0, 16)}Z)` : "never");

async function main() {
  const now = Date.now();
  console.log(`Now ${new Date(now).toISOString()} · a pool is stale after ${POOL_STALE_MS / 60_000} min · a claim is abandoned after ${CLAIM_TTL_MS / 60_000} min\n`);
  console.log("═══ 1. Meta rows ═══");
  const metas = await prisma.poolSnapshot.findMany({ where: { key: { in: POOL_KEYS } }, select: { key: true, builtAt: true, buildingSince: true, error: true, rows: true } });
  const byKey = new Map(metas.map((m) => [m.key, m]));
  for (const key of POOL_KEYS) {
    const m = byKey.get(key);
    if (!m) {
      console.log(`  ${key.padEnd(22)} NO META ROW (never claimed)`);
      continue;
    }
    const chunks = await prisma.poolSnapshot.findMany({ where: { key: { startsWith: `${key}:` } }, select: { key: true, builtAt: true, rows: true, data: true } });
    const dates = new Map<string, number>();
    for (const c of chunks)
      for (const r of Array.isArray(c.data) ? (c.data as { startsAt?: string }[]) : []) {
        if (!r?.startsAt) continue;
        const d = etDateOf(new Date(r.startsAt));
        dates.set(d, (dates.get(d) ?? 0) + 1);
      }
    const chunkBuilt = chunks.map((c) => c.builtAt?.getTime() ?? 0).filter(Boolean);
    console.log(`  ${key}`);
    console.log(`     built ${age(m.builtAt, now)} · rows ${m.rows}`);
    console.log(`     claim ${m.buildingSince ? `held since ${age(m.buildingSince, now)}${now - m.buildingSince.getTime() > CLAIM_TTL_MS ? " (ABANDONED: older than the TTL)" : ""}` : "free"}`);
    console.log(`     error ${m.error ?? "none"}`);
    console.log(`     chunks ${chunks.length} (rows ${chunks.reduce((a, c) => a + c.rows, 0)}; newest chunk ${chunkBuilt.length ? age(new Date(Math.max(...chunkBuilt)), now) : "—"})`);
    console.log(`     game dates (ET) in its rows: ${[...dates].sort().map(([d, n]) => `${d}:${n}`).join(" ") || "—"}`);
  }

  console.log("\n═══ 2. Builds, timed with no deadline (nothing written) ═══");
  for (const key of POOL_KEYS) {
    const t = Date.now();
    try {
      const parts = await POOLS[key]!();
      const rows = Object.values(parts).reduce((a, chunks) => a + chunks.reduce((b, c) => b + c.length, 0), 0);
      const s = (Date.now() - t) / 1000;
      console.log(`  ${key.padEnd(22)} ${s.toFixed(1).padStart(6)} s · ${rows} rows${s > 55 ? "  ← PAST THE WARM ROUTE'S 55 s DEADLINE" : ""}`);
    } catch (e) {
      console.log(`  ${key.padEnd(22)} ${((Date.now() - t) / 1000).toFixed(1).padStart(6)} s · THREW: ${e instanceof Error ? e.message : e}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
