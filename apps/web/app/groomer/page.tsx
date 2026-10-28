"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Mark } from "@/components/Mark";
import { api, ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { readSession, writeSession } from "@/lib/session";

/**
 * 过渡期登录页：店铺 id + 名字 + 共享令牌。用 GET /groomer/:shop/shop 验一次，对了就存到本机。
 * 正式方案是 magic link，到时候这页换成"输入邮箱"。
 */
export default function GroomerLogin() {
  const router = useRouter();
  const { t, locale, setLocale } = useLocale();
  const [shop, setShop] = useState("");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = readSession();
    if (s) router.replace(`/groomer/${encodeURIComponent(s.shop)}/inbox`);
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const session = { shop: shop.trim().toLowerCase(), name: name.trim(), token: token.trim() };
    try {
      await api.shop(session);
      writeSession(session);
      router.replace(`/groomer/${encodeURIComponent(session.shop)}/inbox`);
    } catch (err) {
      setError(err instanceof ApiError ? t("login.failed") : t("login.offline"));
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card enter" onSubmit={submit}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--color-accent)" }}>
          <Mark size={22} />
          <span className="serif" style={{ font: "var(--type-wordmark)", fontFamily: "var(--font-serif)", color: "var(--color-ink)" }}>{t("app.name")}</span>
          <button type="button" className="btn btn-quiet" style={{ marginLeft: "auto" }} onClick={() => setLocale(locale === "zh" ? "en" : "zh")}>{t("nav.language")}</button>
        </div>
        <h1>{t("login.title")}</h1>
        <p className="muted">{t("login.lead")}</p>
        <label className="field">
          <span>{t("login.shop")}</span>
          <input className="input" value={shop} onChange={(e) => setShop(e.target.value)} autoComplete="organization" pattern="[a-z0-9-]+" required placeholder="fluffy-paws-newtown" />
        </label>
        <label className="field">
          <span>{t("login.name")}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} />
        </label>
        <label className="field">
          <span>{t("login.token")}</span>
          <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="current-password" required minLength={16} />
        </label>
        {error && <div className="notice notice-bad" role="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{t("login.submit")}</button>
      </form>
    </div>
  );
}
