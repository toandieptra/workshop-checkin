"use client";

// Token Smax (giống trang "Token Smax" của POS): Partner API token (SMAX_API_TOKEN) cho kênh / tra SĐT / gửi tin,
// và token đăng nhập Smax (SMAX_USER_TOKEN, có hạn) cho tạo / sửa block. Token dán ở đây được thử với Smax
// trước khi lưu, có hiệu lực ngay và được dùng thay cho token trong .env.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { apiPath } from "@/lib/survey-admin";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";

type Kind = "api" | "user";
type TokenInfo = {
  kind: Kind; label: string; configured: boolean; source: "db" | "env" | null; masked: string | null;
  expires_at: string | null; expired: boolean; expires_soon: boolean; updated_at: string | null; updated_by: string | null;
  has_env: boolean; check?: { ok: boolean; error?: string };
};

const META: Record<Kind, { env: string; desc: string; placeholder: string }> = {
  api: {
    env: "SMAX_API_TOKEN",
    desc: "Token tích hợp của Business trên Smax (Cài đặt → API). Dùng để lấy danh sách kênh Zalo cá nhân, tra Zalo theo SĐT, gửi tin và đọc block.",
    placeholder: "Dán partner API token mới",
  },
  user: {
    env: "SMAX_USER_TOKEN",
    desc: "Token đăng nhập web Smax (có hạn, giống ô token đăng nhập của POS). Dùng cho tính năng Partner API chưa có: tạo / sửa / xoá block, tải ảnh và thư mục block.",
    placeholder: "Dán token đăng nhập Smax mới (eyJ…)",
  },
};

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
const errText = (e: unknown) => (e instanceof Error ? e.message : "Thao tác thất bại");

export default function SmaxTokensPanel({ onChange }: { onChange?: () => void }) {
  const { can } = useAuth();
  const manage = can(PERMISSIONS.connectionsManage);
  const [biz, setBiz] = useState<string | null>(null);
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ biz: string | null; tokens: TokenInfo[] }>(apiPath("/api/smax/tokens?check=true"), { adminLoading: false });
      setBiz(r.biz); setTokens(r.tokens); setError(null);
    } catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const replace = (t: TokenInfo) => setTokens((ts) => (ts || []).map((x) => (x.kind === t.kind ? t : x)));

  return <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="font-heading text-lg font-bold text-ink">Token Smax</h2>
      {biz && <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-text-secondary">Business: {biz}</span>}
    </div>
    <p className="mt-1 text-sm text-muted">Liên kết workshop với Smax.AI để gửi tin Zalo cá nhân và Broadcast block. Token dán ở đây được thử với Smax trước khi lưu, có hiệu lực ngay và dùng thay cho token trong .env.</p>
    {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-error">{error}</p>}
    {!tokens && !error && <p className="mt-4 text-sm text-muted">Đang kiểm tra token…</p>}
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      {tokens?.map((t) => <TokenCard key={t.kind} info={t} manage={manage} onUpdated={(n) => { replace(n); onChange?.(); }} />)}
    </div>
  </section>;
}

function TokenCard({ info, manage, onUpdated }: { info: TokenInfo; manage: boolean; onUpdated: (t: TokenInfo) => void }) {
  const meta = META[info.kind];
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<"check" | "save" | "clear" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const run = async (kind: "check" | "save" | "clear") => {
    setBusy(kind); setMsg(null);
    try {
      const path = `/api/smax/tokens/${info.kind}${kind === "check" ? "/check" : ""}`;
      const init: RequestInit = kind === "check" ? { method: "POST" }
        : kind === "clear" ? { method: "DELETE" }
        : { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: value }) };
      const t = await api<TokenInfo>(apiPath(path), init);
      onUpdated(t);
      if (kind === "save") { setValue(""); setShow(false); setMsg({ ok: true, text: "Đã kiểm tra và lưu token" }); }
      if (kind === "clear") setMsg({ ok: true, text: t.configured ? "Đã xoá token đã lưu — đang dùng token trong .env" : "Đã xoá token" });
    } catch (e) { setMsg({ ok: false, text: errText(e) }); }
    finally { setBusy(null); setConfirmClear(false); }
  };

  const state = !info.configured ? { cls: "bg-gray-100 text-gray-600", text: "Chưa cấu hình" }
    : info.expired ? { cls: "bg-red-50 text-red-700", text: "Đã hết hạn" }
    : info.check && !info.check.ok ? { cls: "bg-red-50 text-red-700", text: "Lỗi kết nối" }
    : info.check?.ok ? { cls: "bg-green-50 text-green-700", text: "Đang hoạt động" }
    : { cls: "bg-amber-50 text-amber-700", text: "Chưa kiểm tra" };
  const source = info.source === "db" ? "Lưu trên workshop (trang này)" : info.source === "env" ? `File .env của backend (${meta.env})` : "—";

  return <div className="flex flex-col rounded-md border border-line">
    <div className="border-b border-line p-4">
      <h3 className="flex flex-wrap items-center gap-2 font-semibold text-ink">
        {info.label}<code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs font-normal text-text-secondary">{meta.env}</code>
      </h3>
      <p className="mt-1 text-sm text-muted">{meta.desc}</p>
    </div>
    <div className="border-b border-line p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${state.cls}`}>{state.text}</span>
        {info.configured && <button type="button" disabled={busy !== null} onClick={() => void run("check")}
          className="ml-auto min-h-8 rounded px-2 text-xs font-semibold text-text-secondary hover:bg-surface-muted disabled:opacity-50">
          {busy === "check" ? "Đang kiểm tra…" : "↻ Kiểm tra lại"}</button>}
      </div>
      {info.check && !info.check.ok && <p className="mt-2 text-xs text-error">{info.check.error}</p>}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted">Nguồn</dt><dd className="text-ink">{source}</dd>
        <dt className="text-muted">Token</dt><dd className="font-mono text-ink">{info.masked || "—"}</dd>
        <dt className="text-muted">Hết hạn</dt>
        <dd className={info.expired ? "font-semibold text-error" : info.expires_soon ? "font-semibold text-amber-700" : "text-ink"}>
          {info.expires_at ? `${fmt(info.expires_at)}${info.expired ? " · đã hết hạn" : info.expires_soon ? " · sắp hết hạn" : ""}` : info.configured ? "Không hết hạn" : "—"}
        </dd>
        {info.source === "db" && <><dt className="text-muted">Cập nhật</dt><dd className="text-ink">{fmt(info.updated_at)}{info.updated_by ? ` · ${info.updated_by}` : ""}</dd></>}
      </dl>
    </div>
    {manage && <div className="mt-auto p-4 text-sm">
      <label className="font-semibold text-ink" htmlFor={`smax-token-${info.kind}`}>Token mới</label>
      <div className="mt-2 flex items-center rounded-md border border-line focus-within:border-brand">
        <input id={`smax-token-${info.kind}`} type={show ? "text" : "password"} value={value} autoComplete="off" spellCheck={false}
          onChange={(e) => setValue(e.target.value)} placeholder={meta.placeholder}
          className="min-h-10 min-w-0 flex-1 rounded-md bg-transparent px-3 font-mono text-xs outline-none" />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Ẩn token" : "Hiện token"}
          className="min-h-10 px-3 text-xs font-semibold text-muted hover:text-ink">{show ? "Ẩn" : "Hiện"}</button>
      </div>
      <p className="mt-2 text-xs text-muted">Token được thử với Smax trước khi lưu (sai thì không lưu) và có hiệu lực ngay — không cần sửa .env hay khởi động lại backend.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy !== null || value.trim().length < 20} onClick={() => void run("save")}
          className="min-h-10 rounded-md bg-brand px-4 font-semibold text-brand-teal disabled:opacity-40">{busy === "save" ? "Đang kiểm tra…" : "Kiểm tra & lưu"}</button>
        {info.source === "db" && (confirmClear ? <>
          <span className="text-xs font-semibold text-error">{info.has_env ? "Xoá token đã lưu và quay về token trong .env?" : "Xoá token? Các tính năng Smax sẽ ngừng."}</span>
          <button type="button" disabled={busy !== null} onClick={() => void run("clear")} className="min-h-10 rounded-md bg-red-600 px-3 font-semibold text-white">Xoá</button>
          <button type="button" disabled={busy !== null} onClick={() => setConfirmClear(false)} className="min-h-10 rounded-md border border-line px-3 font-semibold">Không</button>
        </> : <button type="button" disabled={busy !== null} onClick={() => setConfirmClear(true)}
          className="min-h-10 rounded-md border border-red-200 px-3 font-semibold text-red-600">Xoá token đã lưu</button>)}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm font-semibold ${msg.ok ? "text-green-700" : "text-error"}`}>{msg.text}</p>}
    </div>}
  </div>;
}
