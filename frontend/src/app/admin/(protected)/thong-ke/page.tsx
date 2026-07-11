"use client";
import { useEffect, useMemo, useRef, useState } from "react";
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

/** 5 giá trị chuẩn; mọi business_model khác (kể cả rỗng) thuộc nhóm "Khác". */
const BUSINESS_MODEL_KNOWN = [
  "Đang kinh doanh cà phê / trà sữa",
  "Cung cấp dịch vụ đào tạo, setup quán",
  "Công ty / Hộ kinh doanh cung cấp nguyên liệu",
  "Đang chuẩn bị mở quán",
  "Đối tác hợp tác thương hiệu",
] as const;

const BUSINESS_MODEL_FILTER_OPTIONS = [
  ...BUSINESS_MODEL_KNOWN,
  "Khác",
] as const;

type BusinessModelFilter = "" | (typeof BUSINESS_MODEL_FILTER_OPTIONS)[number];

const WS_NAME: Record<string, string> = {};

function matchesBusinessModelFilter(value: string | undefined | null, filter: BusinessModelFilter): boolean {
  if (!filter) return true;
  const v = (value || "").trim();
  if (filter === "Khác") {
    return !BUSINESS_MODEL_KNOWN.includes(v as (typeof BUSINESS_MODEL_KNOWN)[number]);
  }
  return v === filter;
}

export default function ThongKePage() {
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [selectedWorkshopIds, setSelectedWorkshopIds] = useState<string[]>([]);
  const [workshopMenuOpen, setWorkshopMenuOpen] = useState(false);
  const workshopMenuRef = useRef<HTMLDivElement>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkin, setCheckin] = useState<CheckinFilter>("all");
  const [businessModel, setBusinessModel] = useState<BusinessModelFilter>("");
  const [exporting, setExporting] = useState(false);
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [gotoPage, setGotoPage] = useState("1");

  useEffect(() => {
    api("/workshops").then((ws: Workshop[]) => {
      setWorkshops(ws);
      ws.forEach((w) => (WS_NAME[w.id] = w.name));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!workshopMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!workshopMenuRef.current?.contains(e.target as Node)) setWorkshopMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [workshopMenuOpen]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const run = async () => {
      try {
        let list: Workshop[] = [];
        if (selectedWorkshopIds.length === 0) {
          list = await api<Workshop[]>("/workshops");
          list.forEach((w) => (WS_NAME[w.id] = w.name));
        } else {
          list = selectedWorkshopIds.map((id) => ({ id } as Workshop));
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
  }, [selectedWorkshopIds]);

  const filtered = useMemo(() => {
    return guests.filter((g) => {
      if (checkin === "checked_in" && g.checkin_status !== "checked_in") return false;
      if (checkin === "not_checked_in" && g.checkin_status === "checked_in") return false;
      if (!matchesBusinessModelFilter(g.business_model, businessModel)) return false;
      return true;
    });
  }, [guests, checkin, businessModel]);

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

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(currentPage, pageCount);
  const pagedGuests = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );
  const firstRow = filtered.length ? (page - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(page * pageSize, filtered.length);

  useEffect(() => {
    setCurrentPage(1);
    setGotoPage("1");
  }, [selectedWorkshopIds, checkin, businessModel, pageSize]);

  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  const workshopLabel = useMemo(() => {
    if (selectedWorkshopIds.length === 0) return "Tất cả workshop";
    if (selectedWorkshopIds.length === 1) return WS_NAME[selectedWorkshopIds[0]] || "1 workshop";
    if (selectedWorkshopIds.length === workshops.length && workshops.length > 0) return "Tất cả workshop";
    return `${selectedWorkshopIds.length} workshop`;
  }, [selectedWorkshopIds, workshops]);

  const toggleWorkshop = (id: string) => {
    setSelectedWorkshopIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ status: checkin });
      if (selectedWorkshopIds.length) params.set("workshop_ids", selectedWorkshopIds.join(","));
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
            <div className="flex items-center gap-2 min-w-[320px] max-w-full">
              <label className="text-xs font-semibold text-muted whitespace-nowrap">Workshop</label>
              <div className="relative flex-1 min-w-[280px]" ref={workshopMenuRef}>
                <button
                  type="button"
                  aria-label="Chọn workshop"
                  aria-expanded={workshopMenuOpen}
                  aria-haspopup="listbox"
                  onClick={() => setWorkshopMenuOpen((o) => !o)}
                  className="w-full min-w-[320px] border border-line rounded-sm px-2 py-1.5 text-sm bg-surface text-left flex items-center justify-between gap-2"
                >
                  <span className="truncate">{workshopLabel}</span>
                  <span className="text-muted text-xs shrink-0">{workshopMenuOpen ? "▲" : "▼"}</span>
                </button>
                {workshopMenuOpen && (
                  <div
                    role="listbox"
                    aria-multiselectable="true"
                    className="absolute z-20 mt-1 left-0 w-max min-w-full max-w-[min(560px,90vw)] max-h-72 overflow-auto rounded-sm border border-line bg-surface shadow-md"
                  >
                    <label className="flex items-start gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-surface-muted border-b border-line">
                      <input
                        type="checkbox"
                        className="mt-0.5 shrink-0"
                        checked={selectedWorkshopIds.length === 0}
                        onChange={() => setSelectedWorkshopIds([])}
                      />
                      <span>Tất cả workshop</span>
                    </label>
                    {workshops.map((w) => {
                      const checked = selectedWorkshopIds.includes(w.id);
                      return (
                        <label
                          key={w.id}
                          role="option"
                          aria-selected={checked}
                          className="flex items-start gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-surface-muted"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 shrink-0"
                            checked={checked}
                            onChange={() => toggleWorkshop(w.id)}
                          />
                          <span className="whitespace-normal break-words leading-snug">{w.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 min-w-[200px]">
              <label className="text-xs font-semibold text-muted whitespace-nowrap" htmlFor="filter-checkin">
                Trạng thái check-in
              </label>
              <select
                id="filter-checkin"
                aria-label="Trạng thái check-in"
                className="flex-1 border border-line rounded-sm px-2 py-1.5 text-sm bg-surface min-w-[160px]"
                value={checkin}
                onChange={(e) => setCheckin(e.target.value as CheckinFilter)}
              >
                <option value="all">Tất cả</option>
                <option value="checked_in">Đã check-in</option>
                <option value="not_checked_in">Chưa check-in</option>
              </select>
            </div>
            <div className="flex items-center gap-2 min-w-[260px] max-w-full">
              <label className="text-xs font-semibold text-muted whitespace-nowrap" htmlFor="filter-business-model">
                Mô hình kinh doanh
              </label>
              <select
                id="filter-business-model"
                aria-label="Mô hình kinh doanh"
                className="flex-1 border border-line rounded-sm px-2 py-1.5 text-sm bg-surface min-w-[220px] max-w-[min(420px,90vw)]"
                value={businessModel}
                onChange={(e) => setBusinessModel(e.target.value as BusinessModelFilter)}
              >
                <option value="">Tất cả</option>
                {BUSINESS_MODEL_FILTER_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
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
                        {selectedWorkshopIds.length !== 1 && <th className="text-left px-3 py-2">Workshop</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {pagedGuests.map((g) => (
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
                        {selectedWorkshopIds.length !== 1 && <td className="px-3 py-2 text-muted text-xs">{WS_NAME[g.workshop_id] || "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && filtered.length > 0 && (
              <div className="border-t border-line px-3 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="text-muted">Hiển thị {firstRow}–{lastRow} trong tổng số {filtered.length} khách</div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-muted">
                    Dòng/trang
                    <select
                      aria-label="Số dòng hiển thị mỗi trang"
                      className="border border-line rounded-sm bg-surface px-2 py-1 text-ink"
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                    >
                      {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="border border-line rounded-sm px-2 py-1 disabled:opacity-40"
                    disabled={page <= 1}
                    onClick={() => setCurrentPage(page - 1)}
                  >Trước</button>
                  <span>Trang {page}/{pageCount}</span>
                  <button
                    type="button"
                    className="border border-line rounded-sm px-2 py-1 disabled:opacity-40"
                    disabled={page >= pageCount}
                    onClick={() => setCurrentPage(page + 1)}
                  >Sau</button>
                  <label className="flex items-center gap-1.5 text-muted">
                    Đến trang
                    <input
                      aria-label="Nhảy tới trang"
                      type="number"
                      min={1}
                      max={pageCount}
                      className="w-16 border border-line rounded-sm bg-surface px-2 py-1 text-ink"
                      value={gotoPage}
                      onChange={(e) => setGotoPage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const nextPage = Number(gotoPage);
                          if (Number.isInteger(nextPage)) setCurrentPage(Math.min(Math.max(nextPage, 1), pageCount));
                        }
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="border border-line rounded-sm px-2 py-1"
                    onClick={() => {
                      const nextPage = Number(gotoPage);
                      if (Number.isInteger(nextPage)) setCurrentPage(Math.min(Math.max(nextPage, 1), pageCount));
                    }}
                  >Đi tới</button>
                </div>
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
