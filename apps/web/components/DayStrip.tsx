"use client";
import { useLocale } from "@/lib/i18n";
import type { Booking, ShopConfig } from "@/lib/types";
import { fmtTime, splitLocal, weekdayIndex } from "@/lib/format";
import { WEEKDAYS } from "@/lib/types";

/**
 * 这条预约那天店里的安排：营业时间横着铺开，已确认的预约是淡色实块，这一条是虚线框。
 * 一眼看出"确认了会不会撞"，这是美容师做决定前的那个问题。只在屏幕上，没有图表库。
 */
export function DayStrip({ booking, confirmed, shop }: { booking: Booking; confirmed: Booking[]; shop: ShopConfig }) {
  const { t, locale } = useLocale();
  const date = booking.start.slice(0, 10);
  const day = WEEKDAYS[(weekdayIndex(date) + 6) % 7]!; // JS 的周日=0，WEEKDAYS 从周一起
  const hours = shop.hours[day];
  if (!hours) return <p className="muted">{t("detail.dayClosed")}</p>;
  const open = minutes(hours.open);
  const close = minutes(hours.close);
  const span = Math.max(60, close - open);
  const W = 640;
  const H = 56;
  const x = (min: number) => ((min - open) / span) * W;
  const ticks: number[] = [];
  for (let m = Math.ceil(open / 60) * 60; m <= close; m += 60) ticks.push(m);
  const bars = confirmed
    .filter((b) => b.id !== booking.id && b.start.startsWith(date))
    .map((b) => ({ id: b.id, from: minutes(b.start.slice(11)), to: minutes(b.start.slice(11)) + b.durationMin, label: b.pet.name || b.customer.name }));
  const mine = { from: minutes(booking.start.slice(11)), to: minutes(booking.start.slice(11)) + booking.durationMin };
  const clash = bars.some((b) => b.from < mine.to && mine.from < b.to);
  return (
    <div>
      <svg className="daystrip" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t("detail.day")}: ${bars.length}`}>
        <line className="axis" x1="0" x2={W} y1="14" y2="14" />
        {ticks.map((m) => (
          <g key={m}>
            <line className="axis" x1={x(m)} x2={x(m)} y1="10" y2="18" />
            <text className="hour" x={Math.min(x(m), W - 2)} y="30" textAnchor={m === open ? "start" : m === close ? "end" : "middle"}>{`${String(Math.floor(m / 60)).padStart(2, "0")}:00`}</text>{/* taste-skill-ignore: 这是钟点标签 */}
          </g>
        ))}
        {bars.map((b) => (
          <g key={b.id}>
            <rect className="busy" x={x(Math.max(b.from, open))} y="34" width={Math.max(2, x(Math.min(b.to, close)) - x(Math.max(b.from, open)))} height="18" rx="3" />
            {x(b.to) - x(b.from) > 60 && <text className="busy-label" x={x(Math.max(b.from, open)) + 6} y="47">{b.label}</text>}
          </g>
        ))}
        <rect className="this" x={x(Math.max(mine.from, open)) + 0.75} y="34.75" width={Math.max(2, x(Math.min(mine.to, close)) - x(Math.max(mine.from, open)) - 1.5)} height="16.5" rx="3" />
        {x(mine.to) - x(mine.from) > 60 && <text className="this-label" x={x(Math.max(mine.from, open)) + 6} y="47">{fmtTime(booking.start)}</text>}
      </svg>
      <div className="legend">
        <span className="l-busy">{t("status.confirmed")} {bars.length}</span>
        <span className="l-this">{booking.customer.name}</span>
        {clash && <span style={{ color: "var(--color-declined)" }}>{locale === "zh" ? "和已确认的撞了" : "Overlaps a confirmed booking"}</span>}
      </div>
    </div>
  );
}

function minutes(hhmm: string): number {
  const { hh, mm } = splitLocal(`2000-01-01T${hhmm}`);
  return Number(hh) * 60 + Number(mm);
}
