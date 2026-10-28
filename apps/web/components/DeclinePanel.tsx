"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useGroomer } from "@/lib/groomer-context";
import { useLocale } from "@/lib/i18n";
import type { Booking, Slot } from "@/lib/types";
import { addDays, fmtDate, fmtTime, todayIn } from "@/lib/format";

const MAX = 3;

/** 拒绝：写原因，从空档里挑最多三个替代时间（和 agent 看的是同一本日历）。提交前什么都没发生 */
export function DeclinePanel({ booking, onSubmit, onCancel, busy }: { booking: Booking; onSubmit: (reason: string, alternatives: string[]) => void; onCancel: () => void; busy: boolean }) {
  const { session, shop } = useGroomer();
  const { t, locale } = useLocale();
  const today = todayIn(shop.timezone);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(booking.start.slice(0, 10) >= today ? booking.start.slice(0, 10) : today);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    setSlots(null);
    api
      .availability(session, date, booking.serviceId)
      .then((s) => alive && setSlots(s.filter((x) => x.start !== booking.start)))
      .catch(() => alive && setSlots([]));
    return () => {
      alive = false;
    };
  }, [session, date, booking.serviceId, booking.start]);

  function toggle(start: string) {
    setPicked((p) => (p.includes(start) ? p.filter((x) => x !== start) : p.length >= MAX ? p : [...p, start]));
  }

  return (
    <div className="card enter" role="group" aria-label={t("decline.title")}>
      <h3>{t("decline.title")}</h3>
      <label className="field">
        <span>{t("decline.reason")}</span>
        <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={t("decline.reasonHint")} />
      </label>
      <div className="field" style={{ marginTop: "var(--space-3)" }}>
        <span>{t("decline.offer")} <span className="muted">· {t("decline.offerHint")}</span></span>
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-quiet" onClick={() => setDate(addDays(date, -1))} disabled={date <= today} aria-label="Previous day">‹</button>
          <input className="input num" type="date" value={date} min={today} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 170 }} aria-label={t("decline.date")} />
          <button type="button" className="btn btn-quiet" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
          <span className="muted">{fmtDate(date, locale)}</span>
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-2)", minHeight: 28 }}>
          {slots === null && <span className="muted">…</span>}
          {slots && slots.length === 0 && <span className="muted">{t("decline.noSlots")}</span>}
          {slots?.map((s) => (
            <button key={s.start} type="button" className="chip num" aria-pressed={picked.includes(s.start)} onClick={() => toggle(s.start)} disabled={!picked.includes(s.start) && picked.length >= MAX}>
              {fmtTime(s.start)}
            </button>
          ))}
        </div>
        {picked.length > 0 && (
          <div className="muted small num" style={{ marginTop: "var(--space-1)" }}>
            {picked
              .slice()
              .sort()
              .map((p) => `${fmtDate(p.slice(0, 10), locale)} ${fmtTime(p)}`)
              .join(" · ")}
          </div>
        )}
      </div>
      <div className="foot">
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => onSubmit(reason, picked.slice().sort())}>{t("decline.send")}</button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>{t("decline.cancel")}</button>
      </div>
    </div>
  );
}
