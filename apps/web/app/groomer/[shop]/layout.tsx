"use client";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { api, ApiError } from "@/lib/api";
import { GroomerContext } from "@/lib/groomer-context";
import { useLocale } from "@/lib/i18n";
import { clearSession, readSession, type GroomerSession } from "@/lib/session";
import type { Booking, ShopConfig } from "@/lib/types";

const POLL_MS = 30_000;

/** 门卫 + 壳子：没登录或登的不是这家店就回登录页；登了就拉店铺资料和待确认队列，给下面的页面用 */
export default function GroomerShopLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ shop: string }>();
  const router = useRouter();
  const { t } = useLocale();
  const [session, setSession] = useState<GroomerSession | null | undefined>(undefined);
  const [shop, setShop] = useState<ShopConfig | null>(null);
  const [pending, setPending] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = readSession();
    if (!s || s.shop !== params.shop) {
      router.replace("/groomer");
      return;
    }
    setSession(s);
  }, [params.shop, router]);

  const signOut = useCallback(() => {
    clearSession();
    router.replace("/groomer");
  }, [router]);

  const onError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        signOut();
        return;
      }
      setError(e instanceof ApiError ? e.message : t("error.generic"));
    },
    [signOut, t],
  );

  const refreshPending = useCallback(async () => {
    if (!session) return;
    try {
      setPending(await api.bookings(session, "pending"));
      setError(null);
    } catch (e) {
      onError(e);
    }
  }, [session, onError]);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    api
      .shop(session)
      .then((s) => alive && setShop(s))
      .catch(onError);
    void refreshPending();
    const timer = setInterval(() => void refreshPending(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void refreshPending();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session, refreshPending, onError]);

  const value = useMemo(
    () =>
      session && shop
        ? {
            session,
            shop,
            setShop,
            pending,
            refreshPending,
            dropPending: (id: string) => setPending((p) => (p ? p.filter((b) => b.id !== id) : p)),
            signOut,
          }
        : null,
    [session, shop, pending, refreshPending, signOut],
  );

  if (session === undefined || session === null) return null;
  return (
    <Shell session={session} shop={shop} pendingCount={pending?.length ?? 0}>
      {error && <div className="notice notice-bad" role="alert" style={{ margin: "var(--space-4) var(--space-5) 0" }}>{error}</div>}
      {value ? <GroomerContext.Provider value={value}>{children}</GroomerContext.Provider> : null}
    </Shell>
  );
}
