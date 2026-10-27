import { parseShopConfig } from "../src/shop/schema.js";

export const demoShop = parseShopConfig({
  slug: "fluffy-paws-newtown",
  name: "Fluffy Paws Newtown",
  timezone: "Australia/Sydney",
  currency: "AUD",
  hours: { mon: null, tue: { open: "09:00", close: "17:00" }, wed: { open: "09:00", close: "17:00" }, thu: { open: "09:00", close: "17:00" }, fri: { open: "09:00", close: "17:00" }, sat: { open: "09:00", close: "15:00" }, sun: null },
  sizeTiers: [
    { id: "small", label: { en: "Small", zh: "小型" }, maxKg: 10 },
    { id: "medium", label: { en: "Medium", zh: "中型" }, maxKg: 25 },
    { id: "large", label: { en: "Large", zh: "大型" } },
  ],
  services: [
    { id: "full-groom", name: { en: "Full groom", zh: "全套美容" }, durationMin: 120, prices: [
      { size: "small", min: 90, max: 120 }, { size: "medium", min: 120, max: 160 }, { size: "large", min: 160, max: 220 }, { size: "large", coat: "double", min: 190, max: 260 },
    ] },
    { id: "bath-tidy", name: { en: "Bath & tidy", zh: "洗澡修剪" }, durationMin: 60, prices: [
      { size: "small", min: 60, max: 80 }, { size: "medium", min: 80, max: 100 }, { size: "large", min: 100, max: 140 },
    ] },
  ],
  policies: {
    quoteDisclaimer: { en: "Final price is assessed in store based on coat condition.", zh: "最终价格以到店评估毛况为准。" },
  },
});
