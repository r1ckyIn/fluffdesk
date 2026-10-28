"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookingDetail } from "@/components/BookingDetail";
import { BookingList } from "@/components/BookingList";
import { api } from "@/lib/api";
import { useGroomer } from "@/lib/groomer-context";
import { useLocale } from "@/lib/i18n";
import type { Booking } from "@/lib/types";

export default function HistoryPage() {
  return (
    <Suspense fallback={null}>
      <History />
    </Suspense>
  );
}

/** 已处理：最新的决定在最上面，只读 */
function History() {
  const { session, shop, reportError } = useGroomer();
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [items, setItems] = useState<Booking[] | null>(null);
  const [failed, setFailed] = useState(false);
  const selectedId = params.get("b");
  const selected = items?.find((b) => b.id === selectedId) ?? null;
  const select = (id: string | null) => router.replace(id ? `${pathname}?b=${encodeURIComponent(id)}` : pathname, { scroll: false });

  const load = useCallback(() => {
    let alive = true;
    setFailed(false);
    api
      .bookings(session, "decided")
      .then((x) => alive && setItems(x))
      // 失败留在页面自己的错误态上，带重试；布局的横幅会被 30 秒的轮询清掉，不能只靠它。空列表只能来自真正的空结果
      .catch((e) => {
        if (!alive) return;
        setFailed(true);
        reportError(e);
      });
    return () => {
      alive = false;
    };
  }, [session, reportError]);
  useEffect(() => load(), [load]);

  return (
    <div className="inbox" data-view={items && items.length === 0 ? "empty" : selected ? "detail" : "list"}>
      <section className="list-col" aria-label={t("history.title")}>
        <div className="list-head">
          <h1>{t("history.title")}</h1>
          <span className="count num">{items ? items.length : "…"}</span>
        </div>
        {failed ? (
          <p className="notice notice-bad">
            {t("history.failed")} <button type="button" className="btn btn-quiet" onClick={load}>{t("error.retry")}</button>
          </p>
        ) : null}
        {items && items.length === 0 ? <p className="empty">{t("history.empty")}</p> : null}
        {items && items.length > 0 ? <BookingList items={items} selectedId={selectedId} onSelect={select} shop={shop} showStatus /> : null}
      </section>
      <section className="detail-col">{selected ? <BookingDetail booking={selected} onBack={() => select(null)} /> : <p className="empty">{items && items.length > 0 ? t("inbox.pick") : ""}</p>}</section>
    </div>
  );
}
