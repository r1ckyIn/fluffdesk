import { describe, expect, it } from "vitest";
import { addDays, fmtAgo, fmtDate, fmtRange, fmtWhen, splitLocal, weekdayIndex } from "../lib/format";

/** 美容师端的日期算术：不经过 Date 的时区换算，跨月跨年和星期几都得对 */
describe("format: local date strings", () => {
  it("splits a shop-local start without shifting it through the browser timezone", () => {
    expect(splitLocal("2026-11-03T10:30")).toEqual({ y: 2026, m: 11, d: 3, hh: "10", mm: "30" });
    expect(splitLocal("2026-11-03")).toMatchObject({ y: 2026, m: 11, d: 3, hh: "00", mm: "00" });
  });
  it("knows the weekday and crosses month and year boundaries when adding days", () => {
    expect(weekdayIndex("2026-11-03")).toBe(2); // 周二
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });
  it("renders the same instant for both languages", () => {
    expect(fmtWhen("2026-11-03T10:00", "en")).toBe("Tue 3 Nov, 10:00");
    expect(fmtWhen("2026-11-03T10:00", "zh")).toBe("11月3日 周二 10:00");
    expect(fmtDate("2026-11-03", "en")).toBe("Tue 3 Nov");
  });
  it("prints a price range once per currency and a dash when there is no quote", () => {
    expect(fmtRange({ min: 85, max: 110 })).toBe("$85–110");
    expect(fmtRange({ min: 60, max: 60 })).toBe("$60");
    expect(fmtRange(undefined)).toBe("—");
  });
  it("says how long ago in words, stepping from minutes to hours to days", () => {
    const now = Date.parse("2026-11-03T10:00:00Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(fmtAgo(ago(20_000), "en", now)).toBe("now");
    expect(fmtAgo(ago(9 * 60_000), "en", now)).toBe("9 min");
    expect(fmtAgo(ago(3 * 3_600_000), "zh", now)).toBe("3 小时前");
    expect(fmtAgo(ago(26 * 3_600_000), "en", now)).toBe("Yesterday");
    expect(fmtAgo(ago(4 * 86_400_000), "zh", now)).toBe("4 天前");
  });
});
