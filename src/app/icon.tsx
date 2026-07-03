import { ImageResponse } from "next/og";
import { AppIconMark } from "@/lib/appIcon";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<AppIconMark />, size);
}
