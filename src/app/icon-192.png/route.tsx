import { ImageResponse } from "next/og";
import { AppIconMark } from "@/lib/appIcon";

/** Dedicated PWA manifest icon at a predictable /icon-192.png URL — manifest.ts needs concrete icon URLs, not Next's opaque auto-generated /icon?<hash> path. */
export async function GET() {
  return new ImageResponse(<AppIconMark />, { width: 192, height: 192 });
}
