"use client";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookingDetail } from "@/components/BookingDetail";
import { BookingList } from "@/components/BookingList";
import { api, ApiError } from "@/lib/api";
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
  const { session, shop, signOut } = useGroomer();
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [items, setItems] = useState<Booking[] | null>(null);
  const selectedId = params.get("b");
  const selected = items?.find((b) => b.id === selectedId) ?? null;
  const select = (id: string | null) => router.replace(id ? `${pathname}?b=${encodeURIComponent(id)}` : pathname, { scroll: false });

  useEffect(() => {
    let alive = true;
    api
      .bookings(session, "decided")
      .then((x) => alive && setItems(x))
      .catch((e) => (e instanceof ApiError && e.status === 401 ? signOut() : alive && setItems([])));
    return () => {
      alive = false;
    };
  }, [session, signOut]);

  return (
    <div className="inbox" data-view={selected ? "detail" : "list"}>
      <section className="list-col" aria-label={t("history.title")}>
        <div className="list-head">
          <h1>{t("history.title")}</h1>
          <span className="count num">{items ? items.length : "…"}</span>
        </div>
        {items && items.length === 0 ? <p className="empty">{t("history.empty")}</p> : null}
        {items && items.length > 0 ? <BookingList items={items} selectedId={selectedId} onSelect={select} shop={shop} showStatus /> : null}
      </section>
      <section className="detail-col">{selected ? <BookingDetail booking={selected} onBack={() => select(null)} /> : <p className="empty">{items && items.length > 0 ? t("inbox.pick") : ""}</p>}</section>
    </div>
  );
}
