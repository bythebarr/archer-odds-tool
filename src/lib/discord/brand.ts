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
export const MOSES_USERNAME = "Moses, Leader of Many";
export const LOGO_URL = `${SITE_URL}/icon-512.png`;

/** The embed author block — a small round logo + brand name at the top of every post. */
export function mosesAuthor(): { name: string; url: string; icon_url: string } {
  return { name: "ARCHR Edge", url: SITE_URL, icon_url: LOGO_URL };
}
