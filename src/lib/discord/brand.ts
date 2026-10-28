import { SITE_URL } from "@/lib/siteUrl";

/**
 * Shared Discord brand tokens. Every Moses post carries the same identity — the
 * ARCHR target mark + "ARCHR Edge" as the embed author — so the channel reads as
 * one branded product, not a pile of ad-hoc webhooks.
 *
 * LOGO_URL points at the app's public 512px icon. That route bypasses the site's
 * Basic Auth gate (static image extension), so Discord's image proxy can fetch
 * it even though the rest of the site is private.
 */
export const LOGO_URL = `${SITE_URL}/icon-512.png`;

/** The embed author block — a small round logo + brand name at the top of every post. */
export function mosesAuthor(): { name: string; url: string; icon_url: string } {
  return { name: "ARCHR Edge", url: SITE_URL, icon_url: LOGO_URL };
}

/** The webhook display name on every post. */
export const MOSES = "Moses, Leader of Many";

/** ARCHR accent green (matches the app's --accent), as a Discord embed color int. */
export const ARCHR_GREEN = 0x06996b;

/** Stamped on every post — keeps the compliance line in front of members daily. */
export const RESEARCH_FOOTER =
  "Research/entertainment only · not betting advice · 21+ · gamble responsibly 1-800-522-4700";

/** YYYY-MM-DD → "Jul 9" (avoids Date parsing/tz drift on a plain ET date string). */
export function prettyDate(dateEt: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = dateEt.split("-").map(Number);
  return `${months[m - 1]} ${d}`;
}

/** Short market tags for a play line: `MLB ML`, `NBA SPR`. */
export const KIND_TAG: Record<string, string> = { ml: "ML", spread: "SPR", total: "TOT", prop: "PROP" };
