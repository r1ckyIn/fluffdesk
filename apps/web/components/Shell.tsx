"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useLocale } from "@/lib/i18n";
import { clearSession, type GroomerSession } from "@/lib/session";
import type { ShopConfig } from "@/lib/types";
import { fmtDate, todayIn } from "@/lib/format";
import { Mark } from "./Mark";

/**
 * framed-sheet 壳子：侧栏和顶栏共用珠光底、之间没有线，纸面嵌在右下。
 * 侧栏顶上是产品的记号和名字，下面是店（范围），导航只有三个目的地，底下是人和语言。
 */
export function Shell({ session, shop, pendingCount, children }: { session: GroomerSession; shop: ShopConfig | null; pendingCount: number; children: ReactNode }) {
  const { t, locale, setLocale } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const base = `/groomer/${encodeURIComponent(session.shop)}`;
  const today = todayIn(shop?.timezone ?? "Australia/Sydney");
  const items = [
    { href: `${base}/inbox`, label: t("nav.inbox"), count: pendingCount, icon: <path d="M3 12h4l2 3h6l2-3h4M5 5h14l2 7v7H3v-7z" /> },
    { href: `${base}/history`, label: t("nav.history"), count: 0, icon: <path d="M12 7v5l3 2M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" /> },
    { href: `${base}/shop`, label: t("nav.shop"), count: 0, icon: <path d="M4 9l1.5-4h13L20 9M4 9v10h16V9M4 9h16M9 19v-5h6v5" /> },
  ];
  function signOut() {
    clearSession();
    router.replace("/groomer");
  }
  return (
    <div className="app">
      <aside className="sidebar" aria-label={t("app.name")}>
        <div className="brand" style={{ color: "var(--color-accent)" }}>
          <Mark size={22} />
          <span className="wordmark" style={{ color: "var(--color-ink)" }}>{t("app.name")}</span>
        </div>
        <div className="scope">
          <div className="shop-name">{shop?.name ?? session.shop}</div>
          <div className="shop-sub">{shop?.address ?? shop?.timezone ?? ""}</div>
        </div>
        <nav className="nav" aria-label="Sections">
          {items.map((it) => {
            const current = pathname?.startsWith(it.href);
            return (
              <Link key={it.href} href={it.href} className="nav-item" aria-current={current ? "page" : undefined}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{it.icon}</svg>
                <span>{it.label}</span>
                {it.count > 0 && <span className="count num" aria-label={`${it.count} ${t("inbox.count")}`}>{it.count}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="bottom">
          <div className="user-row">
            <span className="avatar" aria-hidden="true">{session.name.slice(0, 1).toUpperCase()}</span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.name}</span>
          </div>
          <button type="button" className="nav-item" onClick={() => setLocale(locale === "zh" ? "en" : "zh")} style={{ border: 0, background: "transparent", cursor: "pointer" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18M12 3a9 9 0 1 0 0 18" /></svg>
            <span>{t("nav.language")}</span>
          </button>
        </div>
      </aside>
      <header className="topbar">
        <div className="today">{fmtDate(today, locale)}</div>
        <div className="right">
          <button type="button" className="btn btn-quiet" onClick={() => setLocale(locale === "zh" ? "en" : "zh")}>{t("nav.language")}</button>
          <button type="button" className="btn btn-quiet" onClick={signOut}>{t("nav.signout")}</button>
        </div>
      </header>
      <main className="sheet">{children}</main>
    </div>
  );
}
