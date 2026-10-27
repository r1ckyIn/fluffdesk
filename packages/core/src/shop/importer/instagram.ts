import type { ShopImporter } from "./index.js";

/** TODO: 抓取并解析。先留接口，让 API 和后台能接上。 */
export const instagramImporter: ShopImporter = {
  type: "instagram",
  canHandle: (url) => /instagram/i.test(url),
  async import(url) {
    return {
      source: { type: "instagram", url, fetchedAt: new Date().toISOString() },
      partial: {},
      confidence: {},
      rawNotes: ["importer not implemented yet"],
    };
  },
};
