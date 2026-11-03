import { getBuilderPool } from "@/lib/builder/pool";
import { generateParlay } from "@/lib/builder/generate";
import type { BuilderSort } from "@/lib/builder/build";
import { WINDOWS, type BuilderKind, type BuilderWindow } from "@/lib/builder/types";

/**
 * The parlay generator's draw (lib/builder/generate), for the Parlay Builder's
 * Generate mode: the page sends its filters, the legs it has locked and the
 * ones it just showed, and gets back one parlay. The pool stays on the server
 * (thousands of legs); only the parlay travels.
 */
export const dynamic = "force-dynamic";

const KINDS: BuilderKind[] = ["prop", "ml", "spread", "total"];
const SORTS: BuilderSort[] = ["archr", "hit", "edge", "cedge"];

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const strings = (v: unknown, max = 40) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length < 200).slice(0, max) : []);

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const pool = await getBuilderPool();
  const result = generateParlay(pool, {
    sports: strings(body.sports),
    legs: Math.round(num(body.legs, 1, 15, 4)),
    window: WINDOWS.includes(body.window as BuilderWindow) ? (body.window as BuilderWindow) : "l10",
    minRate: num(body.minRate, 0, 1, 0.7),
    minArchr: num(body.minArchr, 0, 1, 0),
    minEdge: typeof body.minEdge === "number" ? num(body.minEdge, -1, 1, 0) : null,
    shortest: typeof body.shortest === "number" ? num(body.shortest, -100000, -100, -500) : -Infinity,
    sameGame: body.sameGame === true,
    sort: SORTS.includes(body.sort as BuilderSort) ? (body.sort as BuilderSort) : "archr",
    kinds: strings(body.kinds).filter((k): k is BuilderKind => KINDS.includes(k as BuilderKind)),
    pricedOnly: body.pricedOnly === true,
    lockedIds: strings(body.locked, 15),
    exclude: strings(body.exclude, 60),
    seed: Math.round(num(body.seed, 0, 2 ** 31, 1)),
  });
  return Response.json(result);
}
