"use server";

import { revalidatePath } from "next/cache";
import { setSelection, clearSelection, type PlayStream } from "@/lib/card/selection";
import { todayEt } from "@/lib/dateEt";

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

export async function clearAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  assertOwner(token);

  const dateEt = String(formData.get("dateEt") ?? "") || todayEt();
  await clearSelection(dateEt);
  revalidatePath("/deck");
}
