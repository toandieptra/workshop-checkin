"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/lib/api";

interface ApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit: number;
  is_active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  key: string | null;
}

interface ApiKeyList {
  keys: ApiKeyRecord[];
  available_scopes: string[];
}

const SCOPE_LABELS: Record<string, string> = {
  "workshops.read": "Xem workshop",
  "guests.read": "Xem khách mời",
  "guests.write": "Tạo khách & đăng ký nhanh",
  "checkin.read": "Xem lịch sử check-in",
  "checkin.manage": "Thực hiện check-in",
  "registration_forms.read": "Xem form đăng ký",
  "registration_forms.write": "Gửi form đăng ký",
};

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Chưa có";
}

async function copyToClipboard(value: string): Promise<boolean> {
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back for browsers that reject Clipboard API after an async request.
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

export default function PublicApiSettingsPanel() {
  const [data, setData] = useState<ApiKeyList>({ keys: [], available_scopes: [] });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminApi<ApiKeyList>("/api-keys");
      setData(result);
      setScopes((current) => current.size ? current : new Set(result.available_scopes));
    } catch (error: any) {
      setMessage("Không tải được API key: " + (error?.message || "không rõ"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createKey = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || scopes.size === 0) return;
    setCreating(true);
    setMessage("");
    try {
      const record = await adminApi<ApiKeyRecord>("/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), scopes: [...scopes] }),
      });
      const key = record.key || "";
      setSecret(key);
      const wasCopied = await copyToClipboard(key);
      setCopied(wasCopied);
      setMessage(wasCopied
        ? "Đã tạo và tự động sao chép API key."
        : "Đã tạo API key nhưng trình duyệt không cho phép tự động sao chép. Hãy bấm Sao chép.");
      setName("");
      await load();
    } catch (error: any) {
      setMessage("Không thể tạo API key: " + (error?.message || "không rõ"));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (record: ApiKeyRecord) => {
    if (!confirm(`Thu hồi API key “${record.name}”?`)) return;
    await adminApi(`/api-keys/${record.id}`, { method: "DELETE" });
    await load();
  };

  const rotate = async (record: ApiKeyRecord) => {
    if (!confirm(`Tạo key mới và vô hiệu hóa key “${record.name}” hiện tại?`)) return;
    const replacement = await adminApi<ApiKeyRecord>(`/api-keys/${record.id}/rotate`, { method: "POST" });
    const key = replacement.key || "";
    setSecret(key);
    const wasCopied = await copyToClipboard(key);
    setCopied(wasCopied);
    setMessage(wasCopied
      ? "Đã rotate và tự động sao chép API key mới. Key cũ đã bị thu hồi."
      : "Đã rotate key nhưng trình duyệt không cho phép tự động sao chép. Hãy bấm Sao chép.");
    await load();
  };

  const purge = async (record: ApiKeyRecord) => {
    if (!confirm(`Xóa vĩnh viễn API key “${record.name}”? Thao tác này không thể hoàn tác.`)) return;
    try {
      await adminApi(`/api-keys/${record.id}/purge`, { method: "DELETE" });
      setMessage("Đã xóa vĩnh viễn API key.");
      await load();
    } catch (error: any) {
      setMessage("Không thể xóa API key: " + (error?.message || "không rõ"));
    }
  };

  const copySecret = async () => {
    const wasCopied = await copyToClipboard(secret);
    setCopied(wasCopied);
    setMessage(wasCopied ? "Đã sao chép API key." : "Không thể sao chép tự động. Vui lòng chọn và sao chép key thủ công.");
  };

  return (
    <div className="space-y-5 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-teal">Tích hợp hệ thống</p>
        <h2 className="font-heading mt-1 text-2xl font-bold text-ink">Public API</h2>
        <p className="mt-1 text-sm text-muted">Tạo khóa truy cập, giới hạn quyền và mở tài liệu API cho hệ thống bên thứ ba.</p>
      </div>

      {secret && <div className="rounded-lg border border-amber-300 bg-amber-50 p-5">
        <p className="font-bold text-amber-900">Lưu API key ngay bây giờ</p>
        <p className="mt-1 text-sm text-amber-800">Khóa bí mật chỉ hiển thị một lần. Hệ thống không thể khôi phục lại sau khi đóng.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-ink">{secret}</code>
          <button type="button" onClick={copySecret} className="rounded-md bg-brand-accent px-4 py-2 text-sm font-bold text-white">{copied ? "Đã sao chép ✓" : "Sao chép"}</button>
          <button type="button" onClick={() => { setSecret(""); setCopied(false); }} className="rounded-md border border-line bg-white px-4 py-2 text-sm font-bold text-ink">Đã lưu</button>
        </div>
      </div>}

      {message && <div className="rounded-md border border-line bg-surface-muted px-4 py-3 text-sm text-ink">{message}</div>}

      <form onSubmit={createKey} className="rounded-lg border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div><h3 className="font-heading text-lg font-bold text-ink">Tạo API key</h3><p className="mt-1 text-sm text-muted">Mặc định giới hạn 120 request mỗi phút cho mỗi key.</p></div>
          <a href="/api/public/v1/docs" target="_blank" rel="noreferrer" className="text-sm font-bold text-brand-accent hover:underline">Mở Swagger Docs ↗</a>
        </div>
        <label className="mt-4 block text-sm font-semibold text-ink">Tên tích hợp<input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Ví dụ: CRM Production" className="mt-1 block min-h-11 w-full rounded-md border border-line px-3 outline-none focus:border-brand-accent" /></label>
        <fieldset className="mt-4"><legend className="text-sm font-semibold text-ink">Quyền truy cập</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">
          {data.available_scopes.map((scope) => <label key={scope} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-line px-3 py-2 text-sm text-ink"><input type="checkbox" checked={scopes.has(scope)} onChange={() => setScopes((current) => { const next = new Set(current); next.has(scope) ? next.delete(scope) : next.add(scope); return next; })} className="h-4 w-4 accent-brand-accent" /><span><span className="block font-semibold">{SCOPE_LABELS[scope] || scope}</span><code className="text-xs text-muted">{scope}</code></span></label>)}
        </div></fieldset>
        <button disabled={creating || !name.trim() || scopes.size === 0} className="mt-4 min-h-11 rounded-md bg-brand-accent px-5 text-sm font-bold text-white disabled:opacity-50">{creating ? "Đang tạo..." : "Tạo API key"}</button>
      </form>

      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <div className="border-b border-line px-5 py-4"><h3 className="font-heading text-lg font-bold text-ink">API key hiện có</h3></div>
        {loading ? <p className="p-5 text-sm text-muted">Đang tải...</p> : data.keys.length === 0 ? <p className="p-5 text-sm text-muted">Chưa có API key.</p> : <div className="divide-y divide-line">{data.keys.map((record) => <div key={record.id} className="p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row"><div><div className="flex items-center gap-2"><h4 className="font-bold text-ink">{record.name}</h4><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${record.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{record.is_active ? "Đang hoạt động" : "Đã thu hồi"}</span></div><code className="mt-1 block text-xs text-muted">{record.key_prefix}••••••••</code></div><div className="flex gap-2">{record.is_active ? <><button type="button" onClick={() => rotate(record)} className="min-h-10 rounded-md border border-line px-3 text-sm font-semibold text-ink">Rotate</button><button type="button" onClick={() => revoke(record)} className="min-h-10 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-600">Thu hồi</button></> : <button type="button" onClick={() => purge(record)} className="min-h-10 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700">Xóa hẳn</button>}</div></div>
          <div className="mt-3 flex flex-wrap gap-1.5">{record.scopes.map((scope) => <span key={scope} className="rounded bg-surface-muted px-2 py-1 text-xs text-text-secondary">{scope}</span>)}</div>
          <p className="mt-3 text-xs text-muted">120 req/phút · Dùng gần nhất: {formatDate(record.last_used_at)} · Tạo: {formatDate(record.created_at)}</p>
        </div>)}</div>}
      </div>
    </div>
  );
}
