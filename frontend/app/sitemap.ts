import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://www.lynkxpress.com/",
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
