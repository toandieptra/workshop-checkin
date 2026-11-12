"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { GIFT_STATUS_LABEL } from "@/lib/survey-admin";

type GiftEvent = { action: string; result: string; actor: string | null; method: string | null; created_at: string };
type GiftClaimLog = {
  claim_id: string; status: string; gift_name: string; respondent: string; rating: number | null; submitted_at: string;
  issued_at: string; redeemed_at: string | null; revoke_reason: string | null; events: GiftEvent[];
};
type GiftLog = { checked_in: number; redeemed: number; claims: GiftClaimLog[] };

const ACTION_LABEL: Record<string, string> = { issue: "Phát mã", lookup: "Quét/kiểm tra", redeem: "Trao quà", reissue: "Cấp lại mã", revoke: "Thu hồi" };
const RESULT_LABEL: Record<string, string> = {
  ok: "hợp lệ", already_redeemed: "mã đã dùng", expired: "hết hạn", revoked: "đã thu hồi", wrong_workshop: "sai workshop",
  not_found: "không tìm thấy", invalid_format: "sai định dạng", gift_disabled: "quà đang tạm dừng",
  invalid_response: "phiếu không hợp lệ", invalid_registration: "đăng ký không hợp lệ",
};
const STATUS_CLS: Record<string, string> = {
  issued: "bg-cyan-bg text-brand-teal", redeemed: "bg-green-50 text-green-700", expired: "bg-surface-muted text-muted", revoked: "bg-red-50 text-error",
};

function date(value?: string | null) { return value ? new Date(value).toLocaleString("vi-VN") : "—"; }

/** Log quà khảo sát của một đăng ký: mỗi phiếu → 1 mã quà, kèm lịch sử quét/trao/thu hồi. */
export default function GuestGiftLog({ guestId, workshopId }: { guestId: string; workshopId: string }) {
  const [data, setData] = useState<GiftLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError("");
    try {
      const result = await api<GiftLog>(`/api/workshops/${workshopId}/gifts/guest/${guestId}`, { adminLoading: false });
      if (id === request.current) setData(result);
    } catch (e) {
      if (id === request.current) { setData(null); setError("Không tải được log quà tặng: " + (e instanceof Error ? e.message : "không rõ lỗi")); }
    } finally { if (id === request.current) setLoading(false); }
  }, [guestId, workshopId]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);

  return (
    <section className="rounded-md border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-ink">Quà tặng khảo sát</h4>
          <p className="mt-1 text-xs text-muted">
            {data ? `Đã trao ${data.redeemed}/${data.checked_in} quà (tối đa bằng số khách đã check-in) · ${data.claims.length} phiếu đã gửi` : "Mỗi phiếu khảo sát hoàn thành = 1 mã QR = 1 phần quà khi nhân viên quét hợp lệ."}
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="min-h-9 rounded border border-line px-3 text-xs font-semibold text-brand-teal">{loading ? "Đang tải..." : "Làm mới"}</button>
      </div>
      {error && <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-error">{error}<button type="button" onClick={() => void load()} className="ml-2 underline">Thử lại</button></div>}
      <div className="mt-5 border-t border-line pt-4">
        <h5 className="text-sm font-semibold text-ink">Lịch sử quà tặng</h5>
        {loading && !data ? <div className="mt-3 text-sm text-muted">Đang tải log quà tặng...</div>
          : !data?.claims.length ? <div className="mt-3 text-sm text-muted">Khách chưa gửi phiếu khảo sát nào.</div>
          : (
            <ol className="mt-3 space-y-2">
              {data.claims.map((c, index) => (
                <li key={c.claim_id} className="rounded border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <strong>Phiếu {index + 1} · {c.respondent}{c.rating ? ` · ${c.rating}/5 sao` : ""}</strong>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[c.status] || "bg-surface-muted text-muted"}`}>{GIFT_STATUS_LABEL[c.status] || c.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">{c.gift_name} · gửi phiếu {date(c.submitted_at)}{c.redeemed_at ? ` · trao lúc ${date(c.redeemed_at)}` : ""}{c.revoke_reason ? ` · lý do thu hồi: ${c.revoke_reason}` : ""}</div>
                  {c.events.length > 0 && (
                    <ul className="mt-2 space-y-1 border-l-2 border-line pl-3 text-xs">
                      {c.events.map((e, i) => (
                        <li key={i} className="flex flex-wrap gap-x-2">
                          <span className="tabular-nums text-muted">{date(e.created_at)}</span>
                          <span className={e.action === "redeem" && e.result === "ok" ? "font-semibold text-green-700" : ""}>
                            {ACTION_LABEL[e.action] || e.action} · {RESULT_LABEL[e.result] || e.result}{e.method ? ` · ${e.method === "qr" ? "QR" : "mã tay"}` : ""}
                          </span>
                          <span className="text-muted">{e.actor || (e.action === "issue" || e.action === "reissue" ? "Hệ thống" : "—")}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
      </div>
    </section>
  );
}
