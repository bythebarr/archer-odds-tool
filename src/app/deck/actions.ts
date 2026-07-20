"use server";

import { revalidatePath } from "next/cache";
import { setSelection, setUnits, clearSelection, type PlayStream } from "@/lib/card/selection";
import { todayEt } from "@/lib/dateEt";
import { postDailyCardToDiscord } from "@/lib/discord/postCard";
import { markPosted } from "@/lib/discord/postMarker";

/**
 * Deck mutations. Every action re-checks the shared owner token itself rather
 * than trusting that the page rendered — a server action is its own POST
 * endpoint, reachable without ever loading the page it lives behind, so gating
 * only the page would leave the writes open.
 */
function assertOwner(token: string) {
  const expected = process.env.CRON_SECRET;
  if (!expected || token !== expected) throw new Error("Unauthorized");
}

export async function pickAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  assertOwner(token);

  const playKey = String(formData.get("playKey") ?? "");
  const raw = String(formData.get("stream") ?? "");
  const dateEt = String(formData.get("dateEt") ?? "") || todayEt();
  if (!playKey) throw new Error("Missing playKey");

  const stream: PlayStream | null = raw === "card" || raw === "free" ? raw : null;
  await setSelection(dateEt, playKey, stream);
  revalidatePath("/deck");
}

/**
 * Set the stake on a ticked play. An empty/zero value clears back to the model's
 * suggestion rather than staking nothing — "no opinion" and "0u" are different
 * things, and the deck has no way to express a genuine zero stake (that's what
 * un-ticking is for).
 */
export async function unitsAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  assertOwner(token);

  const playKey = String(formData.get("playKey") ?? "");
  const dateEt = String(formData.get("dateEt") ?? "") || todayEt();
  const raw = String(formData.get("units") ?? "").trim();
  if (!playKey) throw new Error("Missing playKey");

  const parsed = Number(raw);
  const units = raw === "" || !Number.isFinite(parsed) || parsed <= 0 ? null : Math.min(parsed, 25);
  await setUnits(dateEt, playKey, units);
  revalidatePath("/deck");
}

/**
 * Post the card NOW, rather than waiting for the tick.
 *
 * Marks the day as posted on success so the scheduled tick won't post it a
 * second time — firing by hand and firing on schedule are the same event, and
 * the room must only ever see one card a day.
 */
export async function fireAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  assertOwner(token);

  const dateEt = String(formData.get("dateEt") ?? "") || todayEt();
  const result = await postDailyCardToDiscord(dateEt);
  if (result.posted) await markPosted("post-card", dateEt);
  revalidatePath("/deck");
}

export async function clearAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  assertOwner(token);

  const dateEt = String(formData.get("dateEt") ?? "") || todayEt();
  await clearSelection(dateEt);
  revalidatePath("/deck");
}
