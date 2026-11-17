"use client";

// Tab "Tin nhắn Zalo": mẫu tin của workshop | block Smax (Zalo User) dùng cho Broadcast.
import { useState } from "react";
import ZaloMessageSettingsPanel from "./ZaloMessageSettingsPanel";
import SmaxBlocksPanel from "./SmaxBlocksPanel";

export default function ZaloMessagesTab() {
  const [view, setView] = useState<"templates" | "smax">(() => {
    try { return localStorage.getItem("zalo-messages:view") === "smax" ? "smax" : "templates"; } catch { return "templates"; }
  });
  const choose = (v: "templates" | "smax") => { setView(v); try { localStorage.setItem("zalo-messages:view", v); } catch { /* bỏ qua */ } };
  return <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
    <div role="tablist" aria-label="Loại nội dung Zalo" className="mb-4 inline-flex shrink-0 self-start rounded-md border border-line bg-white p-1 text-sm">
      {([["templates", "Mẫu tin workshop"], ["smax", "Block Smax (Broadcast)"]] as const).map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => choose(k)}
          className={`min-h-9 rounded px-3 font-semibold ${view === k ? "bg-brand text-brand-teal" : "text-text-secondary hover:text-ink"}`}>{label}</button>
      ))}
    </div>
    {view === "templates" ? <ZaloMessageSettingsPanel /> : <SmaxBlocksPanel />}
  </div>;
}
