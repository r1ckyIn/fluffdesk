import type { ShopImporter } from "./index.js";

/** TODO: 抓取并解析。先留接口，让 API 和后台能接上。 */
export const googleBusinessImporter: ShopImporter = {
  type: "google",
  canHandle: (url) => /google/i.test(url),
  async import(url) {
    return {
      source: { type: "google", url, fetchedAt: new Date().toISOString() },
      partial: {},
      confidence: {},
      rawNotes: ["importer not implemented yet"],
    };
  },
};
