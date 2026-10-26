import { cookies } from "next/headers";
import { NBA_PROP_STAT_BY_KEY } from "./propStats";
import { PROPS_PREFS_COOKIE, type PropsPrefs } from "./propsPrefsShared";
import type { NbaPropStat } from "@/generated/prisma/client";

const DEFAULT_PREFS: PropsPrefs = { stat: "points", side: "over", sort: "hitRate" };

/** URL params win (a shared link), then the remembered cookie, then defaults. */
function resolvePrefs(params: Record<string, string | undefined>, cookie: string | undefined): PropsPrefs {
  let saved: Partial<PropsPrefs> = {};
  try {
    saved = cookie ? (JSON.parse(cookie) as Partial<PropsPrefs>) : {};
  } catch {
    saved = {};
  }
  const stat = [params.stat, saved.stat].find((s) => NBA_PROP_STAT_BY_KEY.has(s as NbaPropStat)) as NbaPropStat | undefined;
  const side = [params.side, saved.side].find((s) => s === "over" || s === "under") as PropsPrefs["side"] | undefined;
  const sort = [params.sort, saved.sort].find((s) => s === "hitRate" || s === "margin" || s === "price" || s === "value" || s === "model") as
    | PropsPrefs["sort"]
    | undefined;
  return { stat: stat ?? DEFAULT_PREFS.stat, side: side ?? DEFAULT_PREFS.side, sort: sort ?? DEFAULT_PREFS.sort };
}

/** The props finder's starting view for this request: URL, then the remembered cookie, then defaults. */
export async function readPropsPrefs(params: Record<string, string | undefined>): Promise<PropsPrefs> {
  return resolvePrefs(params, (await cookies()).get(PROPS_PREFS_COOKIE)?.value);
}
