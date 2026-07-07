import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "archer — MLB odds line-shopping",
    short_name: "archer",
    description: "MLB odds line-shopping, hit-rates, and EV — research/discovery only.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f9fc",
    theme_color: "#0a0e17",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
