"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

interface Workshop { id: string; name: string; slug: string; }
interface FaceProfile { id: string; image_url?: string; quality_score?: number; is_active: boolean; }
interface Guest {
  id: string; workshop_id: string; full_name: string; phone?: string; email?: string;
  company?: string; business_model?: string; role_title?: string; guest_type?: string; note?: string; party_size?: number;
  consent_face_recognition: boolean; checkin_status: string; checked_in_at?: string;
  created_at?: string; registered_at?: string | null; face_profiles: FaceProfile[];
}

type CheckinFilter = "all" | "checked_in" | "not_checked_in";
type ConsentFilter = "all" | "consent" | "no_consent";
type FaceFilter = "all" | "has_face" | "no_face";

const WS_NAME: Record<string, string> = {};

export default function ThongKePage() {
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [wid, setWid] = useState<string>("all");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);

  const [checkin, setCheckin] = useState<CheckinFilter>("all");
  const [consent, setConsent] = useState<ConsentFilter>("all");
  const [face, setFace] = useState<FaceFilter>("all");

  // load workshops once
  useEffect(() => {
    api("/workshops").then((ws: Workshop[]) => {
      setWorkshops(ws);
      ws.forEach((w) => (WS_NAME[w.id] = w.name));
    }).catch(() => {});
  }, []);

  // load guests theo workshop chon
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const run = async () => {
      try {
        let list: Workshop[] = [];
        if (wid === "all") {
          const ws: Workshop[] = await api("/workshops");
          list = ws;
          ws.forEach((w) => (WS_NAME[w.id] = w.name));
        } else {
          list = [{ id: wid } as Workshop];
        }
        const batches = await Promise.all(
          list.map((w) => api(`/workshops/${w.id}/guests`).catch(() => []))
        );
        if (alive) setGuests(batches.flat());
      } finally {
        if (alive) setLoading(false);
      }
    };
    run();
    return () => { alive = false; };
  }, [wid]);

  const filtered = useMemo(() => {
    return guests.filter((g) => {
      if (checkin === "checked_in" && g.checkin_status !== "checked_in") return false;
      if (checkin === "not_checked_in" && g.checkin_status === "checked_in") return false;
      if (consent === "consent" && !g.consent_face_recognition) return false;
      if (consent === "no_consent" && g.consent_face_recognition) return false;
      const nFace = g.face_profiles?.length || 0;
      if (face === "has_face" && nFace === 0) return false;
      if (face === "no_face" && nFace > 0) return false;
      return true;
    });
  }, [guests, checkin, consent, face]);

  const kpi = useMemo(() => {
    const total = filtered.length;
    const tickets = filtered.reduce((s, g) => s + (g.party_size || 1), 0);
    const checkedIn = filtered.filter((g) => g.checkin_status === "checked_in").length;
    const checkedInTickets = filtered
      .filter((g) => g.checkin_status === "checked_in")
      .reduce((s, g) => s + (g.party_size || 1), 0);
    const consented = filtered.filter((g) => g.consent_face_recognition).length;
    const faces = filtered.reduce((s, g) => s + (g.face_profiles?.length || 0), 0);
    const pct = (n: number, base: number) => (base ? Math.round((n / base) * 100) : 0);
    return {
      total, tickets, checkedIn, checkedInTickets, consented, faces,
      pctCheckedIn: pct(checkedInTickets, tickets), pctConsent: pct(consented, total),
    };
  }, [filtered]);

  const resetFilters = () => { setWid("all"); setCheckin("all"); setConsent("all"); setFace("all"); };

  const exportCsv = () => {
    const head = ["full_name", "business_model", "role_title", "guest_type", "phone", "party_size", "registered_at", "consent", "faces", "status", "checked_in_at", "workshop"];
    const rows = filtered.map((g) => [
      g.full_name, g.business_model || "", g.role_title || "", g.guest_type || "", g.phone || "",
      String(g.party_size || 1), g.registered_at || g.created_at || "",
      g.consent_face_recognition ? "yes" : "no", String(g.face_profiles?.length || 0),
      g.checkin_status, g.checked_in_at || "", WS_NAME[g.workshop_id] || g.workshop_id,
    ]);
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [head, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `thong-ke_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-brand-teal">Thống kê khách mời</h1>
          <button onClick={exportCsv} disabled={!filtered.length}
            className="bg-brand-teal text-white px-3 py-2 rounded-sm text-sm disabled:opacity-40">
            Export CSV ({filtered.length})
          </button>
        </div>

        <div className="grid md:grid-cols-[240px_1fr] gap-4">
          {/* Sidebar filter */}
          <aside className="bg-surface rounded-md border border-line p-4 h-fit md:sticky md:top-20 space-y-5">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Workshop</label>
              <select className="w-full border border-line rounded-sm px-2 py-1.5 text-sm bg-surface"
                value={wid} onChange={(e) => setWid(e.target.value)}>
                <option value="all">Tất cả workshop</option>
                {workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>

            <FilterGroup label="Trạng thái check-in" value={checkin} onChange={(v) => setCheckin(v as CheckinFilter)}
              options={[["all", "Tất cả"], ["checked_in", "Đã check-in"], ["not_checked_in", "Chưa check-in"]]} name="checkin" />

            <FilterGroup label="Consent nhận diện" value={consent} onChange={(v) => setConsent(v as ConsentFilter)}
              options={[["all", "Tất cả"], ["consent", "Có consent"], ["no_consent", "Không consent"]]} name="consent" />

            <FilterGroup label="Ảnh khuôn mặt" value={face} onChange={(v) => setFace(v as FaceFilter)}
              options={[["all", "Tất cả"], ["has_face", "Có ảnh"], ["no_face", "Chưa có ảnh"]]} name="face" />

            <button onClick={resetFilters} className="w-full border border-line rounded-sm px-3 py-1.5 text-sm text-muted hover:text-brand">
              Đặt lại bộ lọc
            </button>
          </aside>

          {/* Content */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard label="Tổng đăng ký (vé)" value={kpi.tickets} sub={`${kpi.total} record`} />
              <KpiCard label="Đã check-in (vé)" value={kpi.checkedInTickets} sub={`${kpi.pctCheckedIn}%`} />
              <KpiCard label="Có consent" value={kpi.consented} sub={`${kpi.pctConsent}%`} />
              <KpiCard label="Ảnh khuôn mặt" value={kpi.faces} />
            </div>

            <div className="bg-surface rounded-md border border-line overflow-hidden">
              {loading ? (
                <div className="py-20 text-center text-muted">Đang tải...</div>
              ) : filtered.length === 0 ? (
                <div className="py-20 text-center text-muted">Không có khách khớp bộ lọc</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-muted text-muted text-xs">
                      <tr>
                        <th className="text-left px-3 py-2">Tên</th>
                        <th className="text-left px-3 py-2">Mô hình kinh doanh</th>
                        <th className="text-left px-3 py-2">Loại</th>
                        <th className="text-center px-3 py-2">Số khách</th>
                        <th className="text-center px-3 py-2">Consent</th>
                        <th className="text-center px-3 py-2">Ảnh</th>
                        <th className="text-center px-3 py-2">Trạng thái</th>
                        <th className="text-left px-3 py-2">Check-in lúc</th>
                        {wid === "all" && <th className="text-left px-3 py-2">Workshop</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {filtered.map((g) => (
                        <tr key={g.id}>
                          <td className="px-3 py-2 font-medium text-ink">{g.full_name}</td>
                          <td className="px-3 py-2 text-muted">{g.business_model || "—"}</td>
                          <td className="px-3 py-2 text-muted">{g.guest_type || "—"}</td>
                          <td className="px-3 py-2 text-center">{g.party_size || 1}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={g.consent_face_recognition ? "text-success" : "text-red-500"}>
                              {g.consent_face_recognition ? "✓" : "✕"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">{g.face_profiles?.length || 0}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              g.checkin_status === "checked_in" ? "bg-success/20 text-success" : "bg-surface-muted text-muted"
                            }`}>
                              {g.checkin_status === "checked_in" ? "Đã check-in" : "Chưa"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted text-xs">
                            {g.checked_in_at ? new Date(g.checked_in_at).toLocaleString("vi-VN") : "—"}
                          </td>
                          {wid === "all" && <td className="px-3 py-2 text-muted text-xs">{WS_NAME[g.workshop_id] || "—"}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="bg-surface rounded-md border border-line p-4">
      <div className="text-muted text-xs">{label}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <div className="text-2xl font-bold text-brand-teal">{value}</div>
        {sub && <div className="text-sm text-brand">{sub}</div>}
      </div>
    </div>
  );
}

function FilterGroup({ label, value, onChange, options, name }: {
  label: string; value: string; onChange: (v: string) => void;
  options: [string, string][]; name: string;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-muted mb-1.5">{label}</div>
      <div className="space-y-1">
        {options.map(([val, lbl]) => (
          <label key={val} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name={name} checked={value === val} onChange={() => onChange(val)} />
            {lbl}
          </label>
        ))}
      </div>
    </div>
  );
}
