import { OgImage, ogSize, ogContentType } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "ARCHR Edge — best line, every book";

export default async function Image() {
  return OgImage();
}
