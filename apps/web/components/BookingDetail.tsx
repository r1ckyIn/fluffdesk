"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useGroomer } from "@/lib/groomer-context";
import { useLocale } from "@/lib/i18n";
import type { Booking, Correction } from "@/lib/types";
import { DASH, fmtAgo, fmtRange, fmtWhen, serviceName, tierLabel } from "@/lib/format";
import { CorrectionForms } from "./CorrectionForms";
import { DayStrip } from "./DayStrip";
import { DeclinePanel } from "./DeclinePanel";
import { StatusPill } from "./StatusPill";
import { Transcript } from "./Transcript";

/**
 * 打开的那一条。顺序按美容师的问题排：这是谁和什么狗 → 要什么、什么时候、报了多少 → 那天撞不撞 →
 * 决定 → 需要的话纠正 agent → 看原始对话。一屏里只有一个主按钮（确认）。
 */
export function BookingDetail({ booking, onDecided, onBack }: { booking: Booking; onDecided?: (b: Booking) => void; onBack?: () => void }) {
  const { session, shop, notify } = useGroomer();
  const { t, locale } = useLocale();
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [confirmed, setConfirmed] = useState<Booking[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const readOnly = booking.status !== "pending";

  useEffect(() => {
    setDeclining(false);
    setFlash(null);
    setPhotos([]);
    let alive = true;
    api.confirmedOn(session, booking.start.slice(0, 10)).then((all) => alive && setConfirmed(all)).catch(() => {});
    api.corrections(session).then((all) => alive && setCorrections(all.filter((c) => c.conversationId === booking.conversationId))).catch(() => {});
    return () => {
      alive = false;
    };
  }, [session, booking.id, booking.conversationId, booking.start]);

  async function decide(status: "confirmed" | "declined", reason?: string, alternatives?: string[]) {
    if (busy) return;
    setBusy(true);
    try {
      const b = await api.decide(session, booking.id, { status, reason: reason || undefined, alternatives: alternatives?.length ? alternatives : undefined });
      // 成功提示交给布局：onDecided 会把这条从队列拿掉，这个组件随之卸载，自己的 flash 没机会显示
      notify(t(status === "confirmed" ? "action.confirmed" : "action.declined"));
      setDeclining(false);
      onDecided?.(b);
    } catch (e) {
      setFlash({ kind: "bad", text: e instanceof ApiError && e.status === 409 ? t("action.gone") : t("error.generic") });
      if (e instanceof ApiError && e.status === 409) onDecided?.({ ...booking, status: "cancelled" });
    } finally {
      setBusy(false);
    }
  }

  // 标题最多两行：人名 + 宠物名；品种放到副标题里
  const petLine = booking.pet.name ?? "";
  const done = { pet: corrections.some((c) => c.kind === "pet_identification"), quote: corrections.some((c) => c.kind === "quote") };

  return (
    <article className="enter" key={booking.id}>
      {onBack && (
        <button type="button" className="btn btn-quiet back-link" onClick={onBack} style={{ marginLeft: -8, marginBottom: "var(--space-3)" }}>‹ {t("list.back")}</button>
      )}
      <header className="detail-head">
        <div>
          <h2 className="detail-title">{booking.customer.name}{petLine ? ` · ${petLine}` : ""}</h2>
          <div className="sub">
            <StatusPill status={booking.status} />
            {booking.pet.breedGuess ? <span>{booking.pet.breedGuess}</span> : null}
            <span className="dotted">{booking.pet.breedGuess ? <span aria-hidden="true">· </span> : null}{serviceName(shop, booking.serviceId, locale)}</span>
            <span className="dotted num"><span aria-hidden="true">· </span>{fmtWhen(booking.start, locale)}</span>
            <span className="dotted num"><span aria-hidden="true">· </span>{fmtRange(booking.quote)}</span>
          </div>
        </div>
        {!readOnly && !declining && (
          <div className="actions">
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setDeclining(true)}>{t("action.decline")}</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide("confirmed")}>{busy ? t("action.confirming") : t("action.confirm")}</button>
          </div>
        )}
      </header>

      {flash && <div className={`notice notice-${flash.kind}`} role="status" style={{ marginBottom: "var(--space-4)" }}>{flash.text}</div>}
      {declining && <DeclinePanel booking={booking} busy={busy} onCancel={() => setDeclining(false)} onSubmit={(reason, alts) => decide("declined", reason, alts)} />}

      {photos.length > 0 && (
        <div className="pet-photos" style={{ marginTop: "var(--space-4)" }}>
          {photos.map((u) => <img key={u} src={u} alt={t("chat.photo")} />)}
        </div>
      )}

      <div className="two-col section">
        <div>
          <h2 style={{ font: "var(--type-section)", marginBottom: "var(--space-3)" }}>{t("detail.customer")}</h2>
          <dl className="kv">
            <dt>{t("detail.customer")}</dt><dd>{booking.customer.name}</dd>
            <dt>{t("detail.contact")}</dt><dd className="num">{booking.customer.contact}</dd>
            <dt>{t("detail.channel")}</dt><dd><span className="pill pill-neutral">{booking.customer.channel}</span></dd>
            <dt>{t("detail.requested")}</dt><dd>{fmtAgo(booking.createdAt, locale)}</dd>
          </dl>
        </div>
        <div>
          <h2 style={{ font: "var(--type-section)", marginBottom: "var(--space-3)" }}>{t("detail.pet")}</h2>
          <dl className="kv">
            <dt>{t("detail.pet")}</dt><dd>{booking.pet.name || DASH} <span className="muted">{booking.pet.species === "cat" ? t("correct.cat") : booking.pet.species === "dog" ? t("correct.dog") : t("correct.other")}</span></dd>
            <dt>{t("detail.breed")}</dt><dd>{booking.pet.breedGuess || DASH}</dd>
            <dt>{t("detail.size")}</dt><dd>{tierLabel(shop, booking.pet.sizeTier, locale) || DASH}{booking.pet.weightKg ? <span className="muted num"> · {booking.pet.weightKg} {t("detail.kg")}</span> : null}</dd>
            <dt>{t("detail.coat")}</dt><dd>{booking.pet.coat ? t(`coat.${booking.pet.coat}` as "coat.short") : DASH}</dd>
            {booking.pet.notes ? (<><dt>{t("detail.notes")}</dt><dd className="text">{booking.pet.notes}</dd></>) : null}
          </dl>
        </div>
      </div>

      <section className="section">
        <h2>{t("detail.service")}</h2>
        <dl className="kv">
          <dt>{t("detail.service")}</dt><dd>{serviceName(shop, booking.serviceId, locale)}</dd>
          <dt>{t("detail.when")}</dt><dd className="num">{fmtWhen(booking.start, locale)}</dd>
          <dt>{t("detail.duration")}</dt><dd className="num">{booking.durationMin} {t("detail.min")}</dd>
          <dt>{t("detail.quote")}</dt><dd className="num">{fmtRange(booking.quote)} <span className="muted">· {shop.policies.quoteDisclaimer[locale]}</span></dd>
          {readOnly && booking.decidedBy ? (<><dt>{t("detail.decidedBy")}</dt><dd>{booking.decidedBy} <span className="muted">· {booking.decidedAt ? fmtAgo(booking.decidedAt, locale) : ""}</span></dd></>) : null}
          {booking.declineReason ? (<><dt>{t("detail.reason")}</dt><dd className="text">{booking.declineReason}</dd></>) : null}
          {booking.alternatives?.length ? (<><dt>{t("detail.alternatives")}</dt><dd className="num">{booking.alternatives.map((a) => fmtWhen(a, locale)).join(" · ")}</dd></>) : null}
        </dl>
      </section>

      <section className="section">
        <h2>{t("detail.day")}</h2>
        <DayStrip booking={booking} confirmed={confirmed} shop={shop} />
      </section>

      <section className="section">
        <h2>{t("correct.pet")} / {t("correct.quote")}</h2>
        <CorrectionForms booking={booking} done={done} onDone={(kind) => setCorrections((c) => [...c, { id: `local_${Date.now()}`, shopSlug: shop.slug, conversationId: booking.conversationId, kind: kind === "pet" ? "pet_identification" : "quote", original: null, corrected: null, by: session.name, createdAt: new Date().toISOString() }])} />
      </section>

      <section className="section">
        <h2>{t("chat.title")}</h2>
        <Transcript conversationId={booking.conversationId} onImages={setPhotos} />
      </section>
    </article>
  );
}
