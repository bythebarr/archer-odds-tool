import { OgImage, ogSize, ogContentType } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "ARCHR Edge — every sport, one board: model leans, hit-rates & EV";

export default function Image() {
  return OgImage();
}
