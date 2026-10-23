/**
 * The props finder's remembered view, shared by the client finder (which writes
 * the cookie) and the server pages (which read it). A plain module, not
 * "use client": a value imported from a client module into server code arrives
 * as a client reference, not the value.
 */
import type { NbaPropStat } from "@/generated/prisma/client";
import type { PropDirection } from "@/lib/props/tally";
import type { PropSort } from "./propsMath";

export interface PropsPrefs {
  stat: NbaPropStat;
  side: PropDirection;
  sort: PropSort;
}

/** Remembered across visits in a cookie, so the server renders the member's last view with no flash. */
export const PROPS_PREFS_COOKIE = "nba_props_prefs";
