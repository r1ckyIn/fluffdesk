import type { ShopImporter } from "./index.js";

/** TODO: 抓取并解析。先留接口，让 API 和后台能接上。 */
export const websiteImporter: ShopImporter = {
  type: "website",
  canHandle: (url) => /website/i.test(url),
  async import(url) {
    return {
      source: { type: "website", url, fetchedAt: new Date().toISOString() },
      partial: {},
      confidence: {},
      rawNotes: ["importer not implemented yet"],
    };
  },
};
