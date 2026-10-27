"use client";
import { useState } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/** 托管聊天页。嵌入小窗复用这个组件，只是套在 iframe 里 */
export default function ChatPage() {
  const { shop } = useParams<{ shop: string }>();
  const [sessionId] = useState(() => (typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now())));
  const [log, setLog] = useState<Array<{ who: "me" | "shop"; text: string }>>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    setLog((l) => [...l, { who: "me", text: t }]);
    setBusy(true);
    try {
      const r = await fetch(`${API}/chat/${shop}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, text: t }) });
      const j = await r.json();
      setLog((l) => [...l, { who: "shop", text: j.reply ?? j.error ?? "..." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <h2 style={{ margin: "8px 0" }}>{shop}</h2>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        {log.map((m, i) => (
          <div key={i} style={{ alignSelf: m.who === "me" ? "flex-end" : "flex-start", background: m.who === "me" ? "#dbeafe" : "#f3f4f6", padding: "8px 12px", borderRadius: 12, maxWidth: "85%", whiteSpace: "pre-wrap" }}>
            {m.text}
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} style={{ display: "flex", gap: 8, paddingTop: 12 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about a groom / 问问价格" style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #d1d5db" }} />
        <button disabled={busy} style={{ padding: "10px 16px", borderRadius: 8 }}>{busy ? "…" : "Send"}</button>
      </form>
    </main>
  );
}
