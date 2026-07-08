"use client";
import { useEffect, useMemo, useState } from "react";
import { api, API_URL } from "@/lib/api";

interface Workshop { id: string; name: string; slug: string; }
interface Guest {
  id: string; workshop_id: string; full_name: string; phone?: string; email?: string;
  company?: string; business_model?: string; role_title?: string; guest_type?: string; note?: string;
  party_size?: number; actual_party_size?: number; checkin_status: string; checked_in_at?: string;
  created_at?: string; registered_at?: string | null;
  sync_status?: string;
}
type CheckinFilter = "all" | "checked_in" | "not_checked_in";

const WS_NAME: Record<string, string> = {};

export default function ThongKePage() {
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [wid, setWid] = useState<string>("all");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkin, setCheckin] = useState<CheckinFilter>("all");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api("/workshops").then((ws: Workshop[]) => {
      setWorkshops(ws);
      ws.forEach((w) => (WS_NAME[w.id] = w.name));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const run = async () => {
      try {
        let list: Workshop[] = [];
        if (wid === "all") {
          list = await api<Workshop[]>("/workshops");
          list.forEach((w) => (WS_NAME[w.id] = w.name));
        } else {
          list = [{ id: wid } as Workshop];
        }
        const batches = await Promise.all(
          list.map((w) => api<Guest[]>("/workshops/" + w.id + "/guests").catch(() => []))
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
      if (checkin === "checked_in") return g.checkin_status === "checked_in";
      if (checkin === "not_checked_in") return g.checkin_status !== "checked_in";
      return true;
    });
  }, [guests, checkin]);

  const kpi = useMemo(() => {
    const registeredGuests = filtered.reduce((s, g) => s + (g.party_size || 1), 0);
    const registeredRecords = filtered.length;
    const checkedInRecords = filtered.filter((g) => g.checkin_status === "checked_in").length;
    const checkedInGuests = filtered
      .filter((g) => g.checkin_status === "checked_in")
      .reduce((s, g) => s + (g.actual_party_size ?? g.party_size ?? 1), 0);
    const synced = filtered.filter((g) => g.sync_status === "synced").length;
    const pct = (n: number, base: number) => (base ? Math.round((n / base) * 100) : 0);
    return {
      registeredGuests, registeredRecords, checkedInGuests, checkedInRecords, synced,
      pctCheckedIn: pct(checkedInGuests, registeredGuests),
      pctSynced: pct(synced, registeredRecords),
    };
  }, [filtered]);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ workshop_id: wid, status: checkin });
      const res = await fetch(API_URL + "/export/guests?" + params.toString());
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "thong-ke_" + new Date().toISOString().slice(0, 10) + ".xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-brand-teal">Thống kê khách mời</h1>
          <button onClick={exportXlsx} disabled={!filtered.length || exporting}
            className="bg-brand-teal text-white px-3 py-2 rounded-sm text-sm disabled:opacity-40">
            {exporting ? "Đang xuất..." : `Xuất Excel (${filtered.length})`}
          </button>
        </div>

        <div className="space-y-4">
          {/* Filter bar */}
          <div className="bg-surface rounded-md border border-line p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2 min-w-[260px]">
              <label className="text-xs font-semibold text-muted whitespace-nowrap">Workshop</label>
              <select className="flex-1 border border-line rounded-sm px-2 py-1.5 text-sm bg-surface min-w-0"
                value={wid} onChange={(e) => setWid(e.target.value)}>
                <option value="all">Tất cả workshop</option>
                {workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-xs font-semibold text-muted whitespace-nowrap">Trạng thái check-in</span>
              {([["all", "Tất cả"], ["checked_in", "Đã check-in"], ["not_checked_in", "Chưa check-in"]] as [string, string][]).map(([val, lbl]) => (
                <label key={val} className="flex items-center gap-1.5 text-sm cursor-pointer whitespace-nowrap">
                  <input type="radio" name="checkin" checked={checkin === val} onChange={() => setCheckin(val as CheckinFilter)} />
                  {lbl}
                </label>
              ))}
            </div>
          </div>

          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Khách tham gia đã đăng ký" value={kpi.registeredGuests} sub="khách" />
            <KpiCard label="Số phiếu đăng ký" value={kpi.registeredRecords} sub="phiếu" />
            <KpiCard label="Khách đã check-in" value={kpi.checkedInGuests} sub={kpi.pctCheckedIn + "%"} />
            <KpiCard label="Số phiếu đã check-in" value={kpi.checkedInRecords} sub="phiếu" />
          </div>

          {/* Table */}
          <div className="bg-surface rounded-md border border-line overflow-hidden">
            {loading ? (
              <div className="py-20 text-center text-muted">Đang tải...</div>
            ) : filtered.length === 0 ? (
              <div className="py-20 text-center text-muted">Không có khách khớp bộ lọc</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[1000px]">
                  <thead className="bg-surface-muted text-muted text-xs">
                    <tr>
                      <th className="text-left px-3 py-2">Tên</th>
                      <th className="text-left px-3 py-2">Mô hình kinh doanh</th>
                      <th className="text-left px-3 py-2">Loại</th>
                      <th className="text-center px-3 py-2">Số khách đăng ký</th>
                      <th className="text-center px-3 py-2">Số khách check-in</th>
                      <th className="text-center px-3 py-2">Trạng thái</th>
                      <th className="text-center px-3 py-2">Đồng bộ Lark</th>
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
                          {g.checkin_status === "checked_in" ? (
                            (() => {
                              const registered = g.party_size || 1;
                              const actual = g.actual_party_size ?? registered;
                              const same = actual === registered;
                              return (
                                <span className={(same ? "text-cyan-600" : "text-red-600") + " font-semibold"}>
                                  {actual}
                                </span>
                              );
                            })()
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={"text-xs px-2 py-0.5 rounded " + (g.checkin_status === "checked_in" ? "bg-green-50 text-green-700" : "bg-surface-muted text-muted")}>
                            {g.checkin_status === "checked_in" ? "Đã check-in" : "Chưa"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {g.sync_status === "synced" ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">Đã đồng bộ</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded bg-surface-muted text-muted">{g.sync_status || "—"}</span>
                          )}
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
