"use client";
import { Suspense, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookingDetail } from "@/components/BookingDetail";
import { BookingList } from "@/components/BookingList";
import { useGroomer } from "@/lib/groomer-context";
import { useLocale } from "@/lib/i18n";

export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <Inbox />
    </Suspense>
  );
}

/** 收件箱：左边队列（384px），右边打开的那条。手机上一次只显示一个区域，选中的 id 在 ?b= 里，返回不丢滚动位置 */
function Inbox() {
  const { shop, pending, dropPending } = useGroomer();
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("b");
  const selected = pending?.find((b) => b.id === selectedId) ?? null;
  const select = (id: string | null) => router.replace(id ? `${pathname}?b=${encodeURIComponent(id)}` : pathname, { scroll: false });

  // 桌面上右栏不留空：没选时自动打开第一条。手机上一次只显示一个区域，所以不自动选，先看列表
  useEffect(() => {
    if (!selectedId && pending && pending.length > 0 && window.matchMedia("(min-width: 900px)").matches) select(pending[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, pending]);

  return (
    <div className="inbox" data-view={selected ? "detail" : "list"}>
      <section className="list-col" aria-label={t("inbox.title")}>
        <div className="list-head">
          <h1>{t("inbox.title")}</h1>
          <span className="count num">{pending ? `${pending.length} ${t("inbox.count")}` : "…"}</span>
        </div>
        {pending && pending.length === 0 ? <p className="empty">{t("inbox.empty")}</p> : null}
        {pending && pending.length > 0 ? <BookingList items={pending} selectedId={selectedId} onSelect={select} shop={shop} /> : null}
      </section>
      <section className="detail-col">
        {selected ? (
          <BookingDetail
            booking={selected}
            onBack={() => select(null)}
            onDecided={(b) => {
              dropPending(b.id);
              select(null);
            }}
          />
        ) : (
          <p className="empty">{pending && pending.length > 0 ? t("inbox.pick") : ""}</p>
        )}
      </section>
    </div>
  );
}
