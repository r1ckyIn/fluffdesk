"use client";
import { useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { useGroomer } from "@/lib/groomer-context";
import { useLocale } from "@/lib/i18n";
import { COATS, WEEKDAYS, type I18nText, type PriceRule, type Service, type ShopConfig, type SizeTier } from "@/lib/types";

/**
 * 店铺资料：两栏设置行，左边说明、右边控件。整份提交，服务端用 core 的 schema 校验，报错原样显示在保存条里。
 * 一屏一个主按钮（保存）。id 字段是 agent 和价目表之间的钥匙，改它会让历史预约对不上，所以新建时能填、保存后只读。
 */
export function ShopForm() {
  const { session, shop, setShop } = useGroomer();
  const { t } = useLocale();
  const [draft, setDraft] = useState<ShopConfig>(() => structuredClone(shop));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(shop), [draft, shop]);
  const existingServiceIds = useMemo(() => new Set(shop.services.map((s) => s.id)), [shop]);
  const existingTierIds = useMemo(() => new Set(shop.sizeTiers.map((s) => s.id)), [shop]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    setMsg(null);
    try {
      const saved = await api.saveShop(session, normalise(draft));
      setShop(saved);
      setDraft(structuredClone(saved));
      setMsg({ kind: "ok", text: t("shop.saved") });
    } catch (err) {
      setMsg({ kind: "bad", text: `${t("shop.invalid")} ${err instanceof ApiError ? err.message : t("error.generic")}` });
    } finally {
      setBusy(false);
    }
  }

  const i18nField = (value: I18nText | undefined, onChange: (v: I18nText) => void, label: string, multiline = false) => (
    <div className="form-row">
      <label className="field">
        <span>{label} · {t("shop.en")}</span>
        {multiline ? <textarea className="textarea" value={value?.en ?? ""} onChange={(e) => onChange({ en: e.target.value, zh: value?.zh ?? "" })} /> : <input className="input" value={value?.en ?? ""} onChange={(e) => onChange({ en: e.target.value, zh: value?.zh ?? "" })} />}
      </label>
      <label className="field">
        <span>{label} · {t("shop.zh")}</span>
        {multiline ? <textarea className="textarea" value={value?.zh ?? ""} onChange={(e) => onChange({ en: value?.en ?? "", zh: e.target.value })} /> : <input className="input" value={value?.zh ?? ""} onChange={(e) => onChange({ en: value?.en ?? "", zh: e.target.value })} />}
      </label>
    </div>
  );

  const setService = (i: number, patch: Partial<Service>) => setDraft({ ...draft, services: draft.services.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setPrice = (i: number, k: number, patch: Partial<PriceRule>) => setService(i, { prices: draft.services[i]!.prices.map((p, j) => (j === k ? { ...p, ...patch } : p)) });
  const setTier = (i: number, patch: Partial<SizeTier>) => setDraft({ ...draft, sizeTiers: draft.sizeTiers.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <form onSubmit={submit} className="enter">
      <div className="title-row">
        <div>
          <h1>{t("shop.title")}</h1>
          <p className="sub">{t("shop.lead")}</p>
        </div>
      </div>

      <section className="form-section">
        <h2>{t("shop.basics")}</h2>
        <div className="form-rows">
          <div className="form-row">
            <label className="field"><span>{t("shop.name")}</span><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label>
            <label className="field"><span>{t("shop.phone")}</span><input className="input num" value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value || undefined })} /></label>
          </div>
          <div className="form-row">
            <label className="field"><span>{t("shop.address")}</span><input className="input" value={draft.address ?? ""} onChange={(e) => setDraft({ ...draft, address: e.target.value || undefined })} /></label>
            <label className="field"><span>{t("shop.website")}</span><input className="input" value={draft.website ?? ""} onChange={(e) => setDraft({ ...draft, website: e.target.value || undefined })} inputMode="url" /></label>
          </div>
        </div>
      </section>

      <section className="form-section">
        <h2>{t("shop.hours")}</h2>
        <div className="form-rows">
          {WEEKDAYS.map((d) => {
            const h = draft.hours[d];
            return (
              <div key={d} className="hours-row">
                <span className="day">{t(`day.${d}`)}</span>
                <label className="check">
                  <input type="checkbox" checked={!!h} onChange={(e) => setDraft({ ...draft, hours: { ...draft.hours, [d]: e.target.checked ? { open: "09:00", close: "17:00" } : null } })} />
                  <span>{h ? t("shop.open") : t("shop.closed")}</span>
                </label>
                <input className="input num" type="time" value={h?.open ?? ""} disabled={!h} onChange={(e) => h && setDraft({ ...draft, hours: { ...draft.hours, [d]: { ...h, open: e.target.value } } })} aria-label={`${t(`day.${d}`)} ${t("shop.open")}`} />
                <input className="input num" type="time" value={h?.close ?? ""} disabled={!h} onChange={(e) => h && setDraft({ ...draft, hours: { ...draft.hours, [d]: { ...h, close: e.target.value } } })} aria-label={`${t(`day.${d}`)} ${t("shop.closed")}`} />
              </div>
            );
          })}
        </div>
      </section>

      <section className="form-section">
        <h2>{t("shop.tiers")}</h2>
        <div className="form-rows">
          {draft.sizeTiers.map((tier, i) => (
            <div key={i} className="service-card">
              <div className="form-row">
                <label className="field"><span>{t("shop.tier.id")}</span><input className="input" value={tier.id} readOnly={existingTierIds.has(tier.id)} onChange={(e) => setTier(i, { id: e.target.value })} pattern="[a-z0-9-]+" required /></label>
                <label className="field"><span>{t("shop.tier.maxKg")}</span><input className="input num" inputMode="decimal" value={tier.maxKg ?? ""} onChange={(e) => setTier(i, { maxKg: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
                <button type="button" className="btn btn-quiet" onClick={() => setDraft({ ...draft, sizeTiers: draft.sizeTiers.filter((_, j) => j !== i) })} disabled={draft.sizeTiers.length <= 1}>{t("shop.remove")}</button>
              </div>
              {i18nField(tier.label, (label) => setTier(i, { label }), t("shop.tier.label"))}
            </div>
          ))}
          <div><button type="button" className="btn btn-outline" onClick={() => setDraft({ ...draft, sizeTiers: [...draft.sizeTiers, { id: "", label: { en: "", zh: "" } }] })}>{t("shop.addTier")}</button></div>
        </div>
      </section>

      <section className="form-section">
        <h2>{t("shop.services")}</h2>
        <div className="form-rows">
          {draft.services.map((svc, i) => (
            <div key={i} className="service-card">
              <div className="form-row">
                <label className="field"><span>{t("shop.service.id")}</span><input className="input" value={svc.id} readOnly={existingServiceIds.has(svc.id)} onChange={(e) => setService(i, { id: e.target.value })} pattern="[a-z0-9-]+" required /></label>
                <label className="field"><span>{t("shop.service.duration")}</span><input className="input num" inputMode="numeric" value={svc.durationMin} onChange={(e) => setService(i, { durationMin: Number(e.target.value) })} min={15} step={15} type="number" required /></label>
                <button type="button" className="btn btn-quiet" onClick={() => setDraft({ ...draft, services: draft.services.filter((_, j) => j !== i) })} disabled={draft.services.length <= 1}>{t("shop.remove")}</button>
              </div>
              {i18nField(svc.name, (name) => setService(i, { name }), t("shop.service.name"))}
              {svc.prices.map((p, k) => (
                <div key={k} className="price-row">
                  <label className="field">
                    <span>{t("shop.price.size")}</span>
                    <select className="select" value={p.size} onChange={(e) => setPrice(i, k, { size: e.target.value })}>
                      {draft.sizeTiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.label.en || tier.id}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>{t("shop.price.coat")}</span>
                    <select className="select" value={p.coat ?? ""} onChange={(e) => setPrice(i, k, { coat: (e.target.value || undefined) as PriceRule["coat"] })}>
                      <option value="">{t("shop.price.any")}</option>
                      {COATS.map((c) => <option key={c} value={c}>{t(`coat.${c}`)}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>{t("shop.price.min")}</span><input className="input num" inputMode="decimal" value={p.min} onChange={(e) => setPrice(i, k, { min: Number(e.target.value) })} type="number" min={0} required /></label>
                  <label className="field"><span>{t("shop.price.max")}</span><input className="input num" inputMode="decimal" value={p.max} onChange={(e) => setPrice(i, k, { max: Number(e.target.value) })} type="number" min={0} required /></label>
                  <button type="button" className="btn btn-quiet" onClick={() => setService(i, { prices: svc.prices.filter((_, j) => j !== k) })} disabled={svc.prices.length <= 1} aria-label={t("shop.remove")}>×</button>
                </div>
              ))}
              <div><button type="button" className="btn btn-quiet" onClick={() => setService(i, { prices: [...svc.prices, { size: draft.sizeTiers[0]?.id ?? "", min: 0, max: 0 }] })}>{t("shop.addPrice")}</button></div>
            </div>
          ))}
          <div><button type="button" className="btn btn-outline" onClick={() => setDraft({ ...draft, services: [...draft.services, { id: "", name: { en: "", zh: "" }, durationMin: 60, prices: [{ size: draft.sizeTiers[0]?.id ?? "", min: 0, max: 0 }] }] })}>{t("shop.addService")}</button></div>
        </div>
      </section>

      <section className="form-section">
        <h2>{t("shop.policies")}</h2>
        <div className="form-rows">
          {i18nField(draft.policies.quoteDisclaimer, (quoteDisclaimer) => setDraft({ ...draft, policies: { ...draft.policies, quoteDisclaimer } }), t("shop.disclaimer"))}
          {i18nField(draft.policies.notes, (notes) => setDraft({ ...draft, policies: { ...draft.policies, notes: notes.en || notes.zh ? notes : undefined } }), t("shop.notes"), true)}
        </div>
      </section>

      <div className="save-bar">
        <button className="btn btn-primary" disabled={busy || !dirty}>{busy ? t("shop.saving") : t("shop.save")}</button>
        <span className={msg ? (msg.kind === "ok" ? "muted" : "") : "muted"} style={msg?.kind === "bad" ? { color: "var(--color-declined)" } : undefined} role="status">
          {msg ? msg.text : dirty ? "" : t("shop.unchanged")}
        </span>
      </div>
    </form>
  );
}

/** 数字输入框给的是字符串或 NaN，提交前收拾干净；空的可选字段去掉 */
function normalise(d: ShopConfig): ShopConfig {
  return {
    ...d,
    sizeTiers: d.sizeTiers.map((t) => ({ ...t, maxKg: t.maxKg === undefined || Number.isNaN(t.maxKg) ? undefined : t.maxKg })),
    services: d.services.map((s) => ({ ...s, durationMin: Number(s.durationMin), prices: s.prices.map((p) => ({ ...p, min: Number(p.min), max: Number(p.max) })) })),
  };
}
