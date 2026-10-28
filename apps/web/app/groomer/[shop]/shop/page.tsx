"use client";
import { ShopForm } from "@/components/ShopForm";

export default function ShopPage() {
  return (
    <div className="canvas" style={{ overflow: "auto" }}>
      <div style={{ maxWidth: 960 }}>
        <ShopForm />
      </div>
    </div>
  );
}
