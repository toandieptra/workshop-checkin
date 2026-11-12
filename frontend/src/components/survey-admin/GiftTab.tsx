"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtDateTime, fromLocalInput, GIFT_STATUS_LABEL, surveyAdminApi, toLocalInput, type GiftClaimRow, type GiftConfig } from "@/lib/survey-admin";

const STATUS_CLS: Record<string, string> = {
  issued: "bg-cyan-bg text-brand-teal", redeemed: "bg-success-soft text-success", expired: "bg-surface-muted text-muted", revoked: "bg-red-50 text-error",
};

export default function GiftTab({ workshopId, config, canManage, onSaved, onError }: {
  workshopId: string; config: GiftConfig; canManage: boolean; onSaved: (t: string) => Promise<void>; onError: (t: string) => void;
}) {
  const [form, setForm] = useState<GiftConfig>(config);
  const [until, setUntil] = useState(toLocalInput(config.redeem_until));
  const [busy, setBusy] = useState(false);
  const [claims, setClaims] = useState<GiftClaimRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    try { const r = await surveyAdminApi.gifts(workshopId); setClaims(r.claims); setCounts(r.counts); } catch (e: any) { onError(e?.message || "Không tải được danh sách quà"); }
  }, [workshopId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setForm(config); setUntil(toLocalInput(config.redeem_until)); }, [config]);

  const save = async () => {
    setBusy(true);
    try { await surveyAdminApi.saveGift(workshopId, { ...form, redeem_until: fromLocalInput(until) }); await onSaved("Đã lưu cấu hình quà tặng"); }
    catch (e: any) { onError(e?.message || "Lưu thất bại"); } finally { setBusy(false); }
  };
  const revoke = async (c: GiftClaimRow) => {
    const reason = window.prompt(`Lý do thu hồi quà của ${c.guest_name}?`);
    if (!reason || reason.trim().length < 2) return;
    try { await surveyAdminApi.revoke(workshopId, c.claim_id, reason.trim()); await load(); await onSaved("Đã thu hồi mã quà"); } catch (e: any) { onError(e?.message || "Không thu hồi được"); }
  };
  const ro = !canManage || busy;
  const rows = filter ? claims.filter((c) => c.status === filter) : claims;

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <section className="h-fit space-y-3 rounded-md border border-line bg-surface p-4 text-sm">
        <h2 className="font-heading text-base font-bold text-brand-teal">Chương trình quà tặng</h2>
        <label className="flex min-h-10 items-center gap-2 font-semibold">
          <input type="checkbox" checked={form.enabled} disabled={ro} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4" />
          Tặng quà khi khách gửi phiếu hợp lệ
        </label>
        <label className="block font-semibold">Tên quà<input value={form.gift_name} disabled={ro} maxLength={200} onChange={(e) => setForm({ ...form, gift_name: e.target.value })} className="mt-1 min-h-11 w-full rounded-md border border-line px-3 font-normal" placeholder="VD: Ly giữ nhiệt LerMao" /></label>
        <label className="block font-semibold">Mô tả<textarea value={form.description || ""} disabled={ro} rows={2} maxLength={1000} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-md border border-line px-3 py-2 font-normal" /></label>
        <label className="block font-semibold">Hướng dẫn nhận quà (hiện trên màn cảm ơn)<textarea value={form.instructions || ""} disabled={ro} rows={2} maxLength={1000} onChange={(e) => setForm({ ...form, instructions: e.target.value })} className="mt-1 w-full rounded-md border border-line px-3 py-2 font-normal" placeholder="Nhân viên tại quầy LerMao sẽ quét mã QR bên dưới. Mỗi phiếu nhận quà 1 lần." /></label>
        <div className="rounded-md bg-cyan-bg px-3 py-2">
          <b>Điều kiện:</b> chỉ số điện thoại đã check-in tại workshop mới làm được khảo sát. Mỗi SĐT gửi tối đa số phiếu bằng số khách đã check-in; mỗi phiếu hoàn thành = 1 mã QR = 1 phần quà khi nhân viên quét hợp lệ và xác nhận.
        </div>
        <label className="block font-semibold">Hạn đổi quà<input type="datetime-local" value={until} disabled={ro} onChange={(e) => setUntil(e.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-line px-3 font-normal" />
          <span className="mt-1 block text-xs font-normal text-muted">Để trống = không giới hạn.</span>
        </label>
        {canManage && <button type="button" onClick={save} disabled={busy} className="min-h-11 w-full rounded-md bg-brand px-4 font-semibold text-brand-teal disabled:opacity-60">{busy ? "Đang lưu…" : "Lưu cấu hình quà"}</button>}
      </section>

      <section className="rounded-md border border-line bg-surface p-4 text-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-base font-bold text-brand-teal">Mã quà đã phát ({claims.length})</h2>
          <div className="flex flex-wrap gap-1">
            {["", "issued", "redeemed", "expired", "revoked"].map((s) => (
              <button key={s || "all"} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}
                className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${filter === s ? "border-brand bg-brand/10 text-brand-teal" : "border-line text-muted"}`}>
                {s ? `${GIFT_STATUS_LABEL[s]} · ${counts[s] || 0}` : `Tất cả · ${claims.length}`}
              </button>
            ))}
          </div>
        </div>
        <div className="admin-table-scroll overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="text-left text-xs uppercase text-muted"><tr><th className="py-2 pr-3">Khách</th><th className="py-2 pr-3">Quà</th><th className="py-2 pr-3">Trạng thái</th><th className="py-2 pr-3">Phát lúc</th><th className="py-2 pr-3">Trao lúc / bởi</th><th /></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.claim_id} className="border-t border-line">
                  <td className="py-2 pr-3"><div className="font-semibold">{c.guest_name}</div><div className="text-xs text-muted">{c.phone_masked}</div></td>
                  <td className="py-2 pr-3">{c.gift_name}</td>
                  <td className="py-2 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[c.status] || ""}`}>{GIFT_STATUS_LABEL[c.status] || c.status}</span>{c.revoke_reason && <div className="text-xs text-muted">{c.revoke_reason}</div>}</td>
                  <td className="py-2 pr-3 text-muted">{fmtDateTime(c.issued_at)}</td>
                  <td className="py-2 pr-3 text-muted">{c.redeemed_at ? `${fmtDateTime(c.redeemed_at)} · ${c.redeemed_by || "—"}` : "—"}</td>
                  <td className="py-2 text-right">{canManage && c.status === "issued" && <button type="button" onClick={() => void revoke(c)} className="min-h-9 px-2 text-xs text-error hover:underline">Thu hồi</button>}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="py-8 text-center text-muted">Chưa có mã quà nào.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
