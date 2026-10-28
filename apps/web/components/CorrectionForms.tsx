"use client";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useGroomer } from "@/lib/groomer-context";
import { useLocale } from "@/lib/i18n";
import type { Booking, PetSummary } from "@/lib/types";
import { DASH, t2 } from "@/lib/format";

/**
 * 两张小卡：纠正识图、纠正报价。提交进 corrections 表，变成 eval 用例。
 * 不改预约本身：报价是给客人的承诺区间，改了也得先让客人知道，这一步留给以后的"重新报价"。
 * 一段会话每类修正只收一次：已纠正过就只剩标签，按钮关掉，免得 eval 集里出现重复条目。
 */
export function CorrectionForms({ booking, done, onDone }: { booking: Booking; done: { pet: boolean; quote: boolean }; onDone: (kind: "pet" | "quote") => void }) {
  return (
    <div className="two-col">
      <PetCorrection booking={booking} done={done.pet} onDone={() => onDone("pet")} />
      <QuoteCorrection booking={booking} done={done.quote} onDone={() => onDone("quote")} />
    </div>
  );
}

function PetCorrection({ booking, done, onDone }: { booking: Booking; done: boolean; onDone: () => void }) {
  const { session, shop } = useGroomer();
  const { t, locale } = useLocale();
  const [pet, setPet] = useState<PetSummary>({ ...booking.pet });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.correct(session, { conversationId: booking.conversationId, kind: "pet_identification", original: booking.pet, corrected: pet, note: note || undefined });
      setMsg(t("correct.saved"));
      onDone();
    } catch {
      setMsg(t("error.generic"));
    } finally {
      setBusy(false);
    }
  }
  const changed = JSON.stringify(pet) !== JSON.stringify(booking.pet);
  return (
    <form className="card" onSubmit={submit}>
      <h3>{t("correct.pet")} {done && <span className="pill pill-neutral" style={{ marginLeft: 8 }}>{t("correct.already")}</span>}</h3>
      <div className="form-grid">
        <label className="field">
          <span>{t("correct.species")}</span>
          <select className="select" value={pet.species} onChange={(e) => setPet({ ...pet, species: e.target.value as PetSummary["species"] })}>
            <option value="dog">{t("correct.dog")}</option>
            <option value="cat">{t("correct.cat")}</option>
            <option value="other">{t("correct.other")}</option>
          </select>
        </label>
        <label className="field">
          <span>{t("correct.breed")}</span>
          <input className="input" value={pet.breedGuess ?? ""} onChange={(e) => setPet({ ...pet, breedGuess: e.target.value || undefined })} maxLength={60} />
        </label>
        <label className="field">
          <span>{t("correct.size")}</span>
          <select className="select" value={pet.sizeTier ?? ""} onChange={(e) => setPet({ ...pet, sizeTier: e.target.value || undefined })}>
            <option value="">{DASH}</option>
            {shop.sizeTiers.map((tier) => (
              <option key={tier.id} value={tier.id}>{t2(tier.label, locale)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("correct.note")}</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </label>
      </div>
      <div className="foot">
        <button className="btn btn-outline" disabled={busy || !changed || done}>{t("correct.save")}</button>
        {msg && <span className="muted small">{msg}</span>}
      </div>
    </form>
  );
}

function QuoteCorrection({ booking, done, onDone }: { booking: Booking; done: boolean; onDone: () => void }) {
  const { session } = useGroomer();
  const { t } = useLocale();
  const [min, setMin] = useState(String(booking.quote?.min ?? ""));
  const [max, setMax] = useState(String(booking.quote?.max ?? ""));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const corrected = { min: Number(min), max: Number(max), currency: "AUD" as const };
  const valid = Number.isFinite(corrected.min) && Number.isFinite(corrected.max) && corrected.min >= 0 && corrected.max >= corrected.min && min !== "" && max !== "";
  const changed = !booking.quote || corrected.min !== booking.quote.min || corrected.max !== booking.quote.max;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.correct(session, { conversationId: booking.conversationId, kind: "quote", original: booking.quote ?? null, corrected, note: note || undefined });
      setMsg(t("correct.saved"));
      onDone();
    } catch {
      setMsg(t("error.generic"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h3>{t("correct.quote")} {done && <span className="pill pill-neutral" style={{ marginLeft: 8 }}>{t("correct.already")}</span>}</h3>
      <div className="form-grid">
        <label className="field">
          <span>{t("correct.min")} $</span>
          <input className="input num" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("correct.max")} $</span>
          <input className="input num" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>{t("correct.note")}</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </label>
      </div>
      <div className="foot">
        <button className="btn btn-outline" disabled={busy || !valid || !changed || done}>{t("correct.save")}</button>
        {msg && <span className="muted small">{msg}</span>}
      </div>
    </form>
  );
}
