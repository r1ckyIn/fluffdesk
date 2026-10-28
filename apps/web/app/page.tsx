import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 24, maxWidth: 560 }}>
      <h1 className="serif" style={{ font: "var(--type-page-title)", fontFamily: "var(--font-serif)" }}>fluffdesk</h1>
      <p style={{ marginTop: 8 }} className="muted">
        客人聊天页：<code>/chat/&lt;shop-slug&gt;</code>
      </p>
      <p style={{ marginTop: 4 }}>
        <Link href="/groomer" className="btn btn-outline" style={{ marginTop: 16 }}>美容师端 / Groomer</Link>
      </p>
    </main>
  );
}
