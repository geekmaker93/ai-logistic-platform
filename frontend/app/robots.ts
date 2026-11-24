import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/carrier",
        "/client",
        "/driver",
        "/driver-application",
        "/reset-password",
        "/support-agent",
      ],
    },
    sitemap: "https://www.lynkxpress.com/sitemap.xml",
  };
}
