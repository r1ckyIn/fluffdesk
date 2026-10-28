import type { I18nText, ShopConfig } from "./types";
import type { Locale } from "./i18n";

/** 预约时间是店铺时区的本地字符串，这里只拆字符串，不经过 Date 的时区换算 */
export function splitLocal(start: string): { y: number; m: number; d: number; hh: string; mm: string } {
  const [date, time = "00:00"] = start.split("T");
  const [y, m, d] = (date ?? "").split("-").map(Number);
  const [hh = "00", mm = "00"] = time.split(":");
  return { y: y ?? 0, m: m ?? 0, d: d ?? 0, hh, mm };
}

const EN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ZH_DAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function weekdayIndex(start: string): number {
  const { y, m, d } = splitLocal(start);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "Tue 4 Nov, 10:00" / "11月4日 周二 10:00" */
export function fmtWhen(start: string, locale: Locale): string {
  const { m, d, hh, mm } = splitLocal(start);
  const wd = weekdayIndex(start);
  return locale === "zh" ? `${m}月${d}日 ${ZH_DAYS[wd]} ${hh}:${mm}` : `${EN_DAYS[wd]} ${d} ${EN_MONTHS[m - 1]}, ${hh}:${mm}`;
}

export function fmtDate(date: string, locale: Locale): string {
  const { m, d } = splitLocal(date);
  const wd = weekdayIndex(date);
  return locale === "zh" ? `${m}月${d}日 ${ZH_DAYS[wd]}` : `${EN_DAYS[wd]} ${d} ${EN_MONTHS[m - 1]}`;
}

export function fmtTime(start: string): string {
  const { hh, mm } = splitLocal(start);
  return `${hh}:${mm}`;
}

/** 行里的"多久以前"，用词不用数字堆：9 min, 3 h, Yesterday, 4 Nov */
export function fmtAgo(iso: string, locale: Locale, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.round(diff / 60000);
  if (min < 1) return locale === "zh" ? "刚刚" : "now";
  if (min < 60) return locale === "zh" ? `${min} 分钟前` : `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return locale === "zh" ? `${h} 小时前` : `${h} h`;
  const days = Math.round(h / 24);
  if (days === 1) return locale === "zh" ? "昨天" : "Yesterday";
  if (days < 7) return locale === "zh" ? `${days} 天前` : `${days} d`;
  const dt = new Date(iso);
  return locale === "zh" ? `${dt.getMonth() + 1}月${dt.getDate()}日` : `${dt.getDate()} ${EN_MONTHS[dt.getMonth()]}`;
}

/** 缺失值的占位：灰色一道，不是文案里的破折号。全站只在这里写一次 */
export const DASH = "—"; // taste-skill-ignore

/** 价格区间：$85–110，货币只写一次 */
export function fmtRange(q: { min: number; max: number } | undefined): string {
  if (!q) return DASH;
  return q.min === q.max ? `$${q.min}` : `$${q.min}–${q.max}`;
}

export function t2(text: I18nText | undefined, locale: Locale): string {
  if (!text) return "";
  return text[locale] || text.en || text.zh || "";
}

export function serviceName(shop: ShopConfig | undefined, serviceId: string, locale: Locale): string {
  const s = shop?.services.find((x) => x.id === serviceId);
  return s ? t2(s.name, locale) : serviceId;
}

export function tierLabel(shop: ShopConfig | undefined, tierId: string | undefined, locale: Locale): string {
  if (!tierId) return "";
  const t = shop?.sizeTiers.find((x) => x.id === tierId);
  return t ? t2(t.label, locale) : tierId;
}

/** 今天在店铺时区的 YYYY-MM-DD */
export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(date: string, n: number): string {
  const { y, m, d } = splitLocal(date);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
