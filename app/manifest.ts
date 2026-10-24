import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const isDevelopment = process.env.NODE_ENV === "development";
  const appName = process.env.PI_WEB_APP_NAME?.trim() || (isDevelopment ? "Pi Web Dev" : "Pi Web");
  const iconSuffix = isDevelopment ? "-dev-v1" : "";
  return {
    id: "/",
    name: appName,
    short_name: appName,
    description: "Local web interface for the pi coding agent",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1a1a1a",
    categories: ["developer", "productivity"],
    lang: "en",
    icons: [
      {
        src: `/icons/icon-192${iconSuffix}.png`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/icons/icon-512${iconSuffix}.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
