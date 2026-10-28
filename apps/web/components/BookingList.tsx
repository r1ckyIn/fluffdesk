"use client";
import { useLocale } from "@/lib/i18n";
import type { Booking, ShopConfig } from "@/lib/types";
import { fmtAgo, fmtWhen, fmtRange, serviceName } from "@/lib/format";
import { StatusPill } from "./StatusPill";

/**
 * 两行一条：第一行是谁（600）和多久以前（灰，右对齐）；第二行是宠物和服务；第三行是希望的时间和报价。
 * 选中的那条用 --active 填充，和 hover、焦点环分开。没有渐变、没有图标方块。
 */
export function BookingList({ items, selectedId, onSelect, shop, showStatus = false }: { items: Booking[]; selectedId: string | null; onSelect: (id: string) => void; shop: ShopConfig; showStatus?: boolean }) {
  const { t, locale } = useLocale();
  return (
    <div className="rows" role="listbox" aria-label={showStatus ? t("history.title") : t("inbox.title")}>
      {items.map((b) => {
        const pet = [b.pet.name, b.pet.breedGuess].filter(Boolean).join(" · ") || (b.pet.species === "cat" ? t("correct.cat") : t("correct.dog"));
        return (
          <button key={b.id} type="button" role="option" aria-selected={b.id === selectedId} className="row" onClick={() => onSelect(b.id)}>
            <span className="who">{b.customer.name}</span>
            <span className="when">{fmtAgo(b.decidedAt ?? b.createdAt, locale)}</span>
            <span className="what">{pet} · {serviceName(shop, b.serviceId, locale)}</span>
            {showStatus ? <span className="mark"><StatusPill status={b.status} /></span> : <span />}
            <span className="time muted num">
              <span>{fmtWhen(b.start, locale)}</span>
              <span aria-hidden="true">·</span>
              <span>{fmtRange(b.quote)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
