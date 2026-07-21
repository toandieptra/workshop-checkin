"use client";
import { useEffect, useRef, useState } from "react";
import {
  getPublicRegistrationForm,
  submitPublicRegistrationForm,
  type RegistrationFormPublic,
} from "@/lib/api";
import { GUEST_SOURCE_OPTIONS } from "@/lib/guest-sources";
import { formatEventDateTime, shortLocation } from "@/lib/date-format";

// Trang phụ thuộc token ở runtime → không prerender tĩnh.
export const dynamic = "force-dynamic";

type Step = "loading" | "form" | "success" | "error" | "closed";

// Regex SĐT thô: số, khoảng trắng, +, -, (), . — 9-15 ký tự.
const PHONE_RE = /^[\d\s\-+().]{9,15}$/;

function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("84") && d.length >= 11) d = "0" + d.slice(2);
  return d;
}

export default function RegisterPage({ params }: { params: { token: string } }) {
  const token = params.token;

  const [form, setForm] = useState<RegistrationFormPublic | null>(null);
  const [step, setStep] = useState<Step>("loading");
  const [errMsg, setErrMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [registrationStatus, setRegistrationStatus] = useState<"pending" | "confirmed">("pending");

  // Fields
  const [workshopId, setWorkshopId] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState(1);
  const [businessModel, setBusinessModel] = useState("");
  const [source, setSource] = useState("");
  const [sourceDetail, setSourceDetail] = useState("");

  // Field-level errors
  const [errWorkshop, setErrWorkshop] = useState("");
  const [errName, setErrName] = useState("");
  const [errPhone, setErrPhone] = useState("");
  const [errParty, setErrParty] = useState("");
  const [errBusinessModel, setErrBusinessModel] = useState("");
  const [errSource, setErrSource] = useState("");
  const workshopRef = useRef<HTMLSelectElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const partyRef = useRef<HTMLInputElement>(null);
  const businessModelRef = useRef<HTMLSelectElement>(null);
  const sourceRef = useRef<HTMLSelectElement>(null);
  const sourceDetailRef = useRef<HTMLInputElement>(null);

  const BUSINESS_MODEL_OPTIONS = [
    "Đang kinh doanh cà phê / trà sữa",
    "Cung cấp dịch vụ đào tạo, setup quán",
    "Công ty / Hộ kinh doanh cung cấp nguyên liệu",
    "Đang chuẩn bị mở quán",
    "Đối tác hợp tác thương hiệu",
    "Khác",
  ];

  useEffect(() => {
    if (!token) {
      setErrMsg("Thiếu mã form. Vui lòng kiểm tra lại link.");
      setStep("error");
      return;
    }
    (async () => {
      try {
        const f = await getPublicRegistrationForm(token);
        setForm(f);
        const ws = f.workshops?.length
          ? f.workshops
          : f.workshop_id
          ? [{ id: f.workshop_id, name: f.workshop_name, event_date: f.workshop_event_date, location: f.workshop_location }]
          : [];
        setWorkshopId(ws.length === 1 ? ws[0].id : "");
        setStep(f.is_active ? "form" : "closed");
      } catch {
        setErrMsg("Form không tồn tại hoặc đã bị xoá.");
        setStep("error");
      }
    })();
  }, [token]);

  const validate = (): boolean => {
    let ok = true;
    if (!workshopId) {
      setErrWorkshop("Vui lòng chọn workshop.");
      ok = false;
    } else setErrWorkshop("");

    if (!fullName.trim()) {
      setErrName("Vui lòng nhập họ và tên.");
      ok = false;
    } else setErrName("");

    if (!phone.trim()) {
      setErrPhone("Vui lòng nhập số điện thoại.");
      ok = false;
    } else if (!PHONE_RE.test(phone.trim()) || normalizePhone(phone).length < 9 || normalizePhone(phone).length > 11) {
      setErrPhone("Số điện thoại không hợp lệ.");
      ok = false;
    } else setErrPhone("");

    if (!partySize || partySize < 1) {
      setErrParty("Số khách đăng ký phải lớn hơn hoặc bằng 1.");
      ok = false;
    } else setErrParty("");

    if (!businessModel.trim() || !BUSINESS_MODEL_OPTIONS.includes(businessModel)) {
      setErrBusinessModel("Vui lòng chọn mô hình kinh doanh.");
      ok = false;
    } else setErrBusinessModel("");

    if (!source || !GUEST_SOURCE_OPTIONS.includes(source as typeof GUEST_SOURCE_OPTIONS[number])) {
      setErrSource("Vui lòng chọn nguồn thông tin Workshop.");
      ok = false;
    } else if (source === "Khác" && !sourceDetail.trim()) {
      setErrSource("Vui lòng ghi rõ nguồn thông tin.");
      ok = false;
    } else setErrSource("");

    if (!ok) {
      const target = !workshopId ? workshopRef.current
        : !fullName.trim() ? nameRef.current
        : !phone.trim() || !PHONE_RE.test(phone.trim()) || normalizePhone(phone).length < 9 || normalizePhone(phone).length > 11 ? phoneRef.current
        : !partySize || partySize < 1 ? partyRef.current
        : !businessModel.trim() || !BUSINESS_MODEL_OPTIONS.includes(businessModel) ? businessModelRef.current
        : source === "Khác" && !sourceDetail.trim() ? sourceDetailRef.current
        : sourceRef.current;
      requestAnimationFrame(() => target?.focus());
    }
    return ok;
  };

  const submit = async () => {
    if (busy) return;
    if (!validate()) return;
    setBusy(true);
    setErrMsg("");
    try {
      const result = await submitPublicRegistrationForm(token, {
        workshop_id: workshopId,
        full_name: fullName.trim(),
        phone: normalizePhone(phone),
        party_size: Math.max(1, Math.floor(partySize) || 1),
        business_model: businessModel.trim() || undefined,
        source,
        source_detail: source === "Khác" ? sourceDetail.trim() : undefined,
      });
      setRegistrationStatus(result.registration_status);
      setStep("success");
    } catch (e: any) {
      if (e?.message?.includes("410")) {
        setStep("closed");
      } else {
        setErrMsg("Lỗi đăng ký: " + (e?.message || "vui lòng thử lại"));
      }
    } finally {
      setBusy(false);
    }
  };

  const workshopOptions = form?.workshops?.length ? form.workshops : form ? [{
    id: form.workshop_id,
    name: form.workshop_name,
    event_date: form.workshop_event_date,
    location: form.workshop_location,
  }] : [];
  const selectedWorkshop = workshopOptions.find((w) => w.id === workshopId) || workshopOptions[0];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_12%_18%,rgba(0,183,204,0.14),transparent_32%),radial-gradient(circle_at_90%_10%,rgba(201,168,76,0.10),transparent_24%),linear-gradient(180deg,#FFFFFF_0%,#E8F4F5_100%)] px-4 py-5 text-brand-teal sm:px-6 lg:px-10 lg:py-7">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 pb-6 sm:pb-8">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-[14px] bg-[radial-gradient(circle_at_50%_30%,#1A5F6A,#0D3B42)] font-heading text-sm font-extrabold tracking-[-0.05em] text-white shadow-[0_12px_26px_rgba(13,59,66,0.22)]">
            HS
          </div>
          <div>
            <div className="font-heading text-base font-bold leading-tight tracking-[0.02em]">Hi Sweetie Việt Nam</div>
            <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[#3A6B74]">Đăng ký Workshop</div>
          </div>
        </div>
        <a href="tel:0973123230" aria-label="Gọi hotline 0973 123 230" className="hidden items-center gap-2 rounded-full border border-brand/25 bg-white/75 px-4 py-2 text-xs font-semibold text-brand-teal shadow-sm backdrop-blur sm:inline-flex">
          <span className="h-2 w-2 rounded-full bg-brand shadow-[0_0_0_5px_rgba(0,183,204,0.12)]" />
          Hotline: 0973 123 230
        </a>
      </div>

      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.72fr)] lg:items-start">
        {step === "form" && selectedWorkshop && (
          <aside className="hidden overflow-hidden rounded-[28px] bg-[radial-gradient(circle_at_20%_18%,rgba(0,183,204,0.34),transparent_30%),radial-gradient(circle_at_center,#1A5F6A_0%,#0D3B42_76%)] p-10 text-white shadow-[0_28px_80px_rgba(13,59,66,0.24)] lg:block" aria-label="Thông tin workshop">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-cyan-soft">Workshop Diệp Trà</p>
            <div className="mt-6 font-heading text-5xl font-bold leading-tight tracking-[-0.04em]">Đăng ký tham dự workshop</div>
            <p className="mt-4 max-w-xl text-base leading-7 text-white/80">Xác nhận thông tin workshop trước khi gửi đăng ký.</p>
            <div className="mt-10 rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur">
              <h2 className="font-heading text-2xl font-bold">{selectedWorkshop.name}</h2>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                {selectedWorkshop.event_date && <div><dt className="text-xs font-bold uppercase tracking-wide text-cyan-soft">Thời gian</dt><dd className="mt-1 font-semibold">{formatEventDateTime(selectedWorkshop.event_date, undefined, true)}</dd></div>}
                {selectedWorkshop.location && <div><dt className="text-xs font-bold uppercase tracking-wide text-cyan-soft">Địa điểm</dt><dd className="mt-1 font-semibold">{selectedWorkshop.location}</dd></div>}
              </dl>
            </div>
            {form?.greeting && <p className="mt-8 whitespace-pre-line text-sm leading-7 text-white/80">{form.greeting}</p>}
          </aside>
        )}
        <div className="relative w-full rounded-[28px] border border-line bg-white/95 p-6 shadow-[0_24px_70px_rgba(13,59,66,0.14)] backdrop-blur sm:p-8">
          <div className="absolute inset-x-0 top-0 h-1.5 rounded-t-[28px] bg-[linear-gradient(90deg,#00B7CC,#2E8B8F,#C9A84C)]" />

          {step === "loading" && (
            <div className="space-y-6 py-6">
              <div>
                <div className="mb-3 h-3 w-32 rounded-full bg-brand/15" />
                <div className="h-8 w-3/4 rounded-full bg-[#E8F4F5]" />
                <div className="mt-3 h-4 w-full rounded-full bg-[#E8F4F5]" />
              </div>
              <div className="space-y-4">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="h-14 rounded-[14px] border border-line bg-[#F5FAFB]" />
                ))}
              </div>
              <div className="text-sm font-medium text-[#5A8A92]">Đang kiểm tra link đăng ký…</div>
            </div>
          )}

          {step === "form" && (
            <>
              <h1 className="font-heading text-3xl font-bold leading-tight tracking-[-0.035em] text-brand-teal sm:text-[34px]">
                Thông tin đăng ký
              </h1>
              <p className="mt-2 text-sm leading-6 text-[#3A6B74]">
                Vui lòng để lại thông tin chính xác để đội ngũ Hi Sweetie Việt Nam xác nhận suất tham dự.
              </p>

              {form?.greeting && (
                <div className="mt-5 flex gap-3 rounded-2xl border border-line bg-[#E8F4F5]/80 p-4 text-sm leading-6 text-[#3A6B74]">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand text-xs font-extrabold text-white">i</span>
                  <span className="whitespace-pre-line">{form.greeting}</span>
                </div>
              )}

              {errMsg && (
                <div role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
                  {errMsg}
                </div>
              )}

              {selectedWorkshop && <div className="mb-5 rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm text-text-secondary lg:hidden">
                <div className="font-semibold text-brand-teal">{selectedWorkshop.name}</div>
                <div className="mt-1 text-xs">{formatEventDateTime(selectedWorkshop.event_date, undefined, true)}{selectedWorkshop.location ? ` · ${shortLocation(selectedWorkshop.location)}` : ""}</div>
              </div>}

              <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
                <div>
                  {workshopOptions.length > 1 ? <>
                    <label htmlFor="registration-workshop" className="mb-2 block text-sm font-bold text-brand-teal">Workshop <span className="text-brand-accent">*</span></label>
                    <select
                      id="registration-workshop" name="workshop" required ref={workshopRef}
                      value={workshopId}
                      onChange={(e) => setWorkshopId(e.target.value)}
                      aria-invalid={Boolean(errWorkshop)} aria-describedby={errWorkshop ? "registration-workshop-error" : undefined}
                      className="min-h-[52px] w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 text-[15px] font-medium text-brand-teal transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                    >
                      <option value="" disabled>— Chọn workshop —</option>
                      {workshopOptions.map((w) => <option key={w.id} value={w.id}>{w.name}{w.event_date ? " — " + formatEventDateTime(w.event_date) : ""}</option>)}
                    </select>
                  </> : <input type="hidden" id="registration-workshop" name="workshop" value={workshopId} ref={workshopRef as unknown as React.RefObject<HTMLInputElement>} />}
                  {errWorkshop && <div id="registration-workshop-error" role="alert" className="mt-1.5 text-xs font-semibold text-red-600">{errWorkshop}</div>}
                </div>

                <div>
                  <label htmlFor="registration-name" className="mb-2 block text-sm font-bold text-brand-teal">
                    Họ và tên <span className="text-brand-accent">*</span>
                  </label>
                  <input
                    id="registration-name" name="name" required autoComplete="name" ref={nameRef}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nguyễn Văn A"
                    aria-invalid={Boolean(errName)} aria-describedby={errName ? "registration-name-error" : undefined}
                    className="min-h-[52px] w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 text-[15px] font-medium text-brand-teal transition placeholder:text-[#7BA4AA] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                  />
                  {errName && <div id="registration-name-error" role="alert" className="mt-1.5 text-xs font-semibold text-red-600">{errName}</div>}
                </div>

                <div className="grid gap-4 sm:grid-cols-[1fr_0.72fr]">
                  <div>
                    <label htmlFor="registration-phone" className="mb-2 block text-sm font-bold text-brand-teal">
                      Số điện thoại <span className="text-brand-accent">*</span>
                    </label>
                    <input
                      id="registration-phone" name="phone" type="tel" inputMode="tel" required autoComplete="tel" ref={phoneRef}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="0909 123 456"
                      aria-invalid={Boolean(errPhone)} aria-describedby={`registration-phone-hint${errPhone ? " registration-phone-error" : ""}`}
                      className="min-h-[52px] w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 font-mono text-[15px] font-medium text-brand-teal transition placeholder:text-[#7BA4AA] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                    />
                    <div id="registration-phone-hint" className="mt-1.5 text-xs leading-5 text-text-secondary">Dùng để xác nhận suất tham dự.</div>
                    {errPhone && <div id="registration-phone-error" role="alert" className="mt-1.5 text-xs font-semibold text-red-600">{errPhone}</div>}
                  </div>

                  <div>
                    <label htmlFor="registration-party" className="mb-2 block text-sm font-bold text-brand-teal">
                      Số khách <span className="text-brand-accent">*</span>
                    </label>
                    <div className="grid min-h-[52px] grid-cols-[52px_minmax(0,1fr)_52px] overflow-hidden rounded-[14px] border-[1.5px] border-line bg-white transition focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10">
                      <button
                        type="button"
                        aria-label="Giảm số khách"
                        disabled={partySize <= 1}
                        onClick={() => setPartySize((value) => Math.max(1, value - 1))}
                        className="grid place-items-center text-2xl font-semibold text-brand-teal transition active:bg-brand/10 disabled:opacity-30"
                      >
                        −
                      </button>
                      <input
                        id="registration-party" name="partySize" type="number" inputMode="numeric" required ref={partyRef}
                        min={1}
                        value={partySize}
                        onChange={(e) => setPartySize(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="min-w-0 border-x border-line bg-white px-2 py-3 text-center font-mono text-lg font-medium text-brand-teal focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        aria-label="Tăng số khách"
                        onClick={() => setPartySize((value) => value + 1)}
                        className="grid place-items-center text-2xl font-semibold text-brand-teal transition active:bg-brand/10"
                      >
                        +
                      </button>
                    </div>
                    <div className="mt-1.5 text-xs leading-5 text-text-secondary">Số người tham dự.</div>
                    {errParty && <div className="mt-1.5 text-xs font-semibold text-red-600">{errParty}</div>}
                  </div>
                </div>

                <div>
                  <label htmlFor="registration-business-model" className="mb-2 block text-sm font-bold text-brand-teal">
                    Mô hình kinh doanh <span className="text-brand-accent">*</span>
                  </label>
                  <select
                    id="registration-business-model" name="businessModel" required ref={businessModelRef}
                    value={businessModel}
                    onChange={(e) => setBusinessModel(e.target.value)}
                    className="min-h-[52px] w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 text-[15px] font-medium text-brand-teal transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                  >
                    <option value="" disabled>
                      — Chọn mô hình phù hợp —
                    </option>
                    {BUSINESS_MODEL_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  {errBusinessModel && <div className="mt-1.5 text-xs font-semibold text-red-600">{errBusinessModel}</div>}
                </div>

                <div>
                  <label htmlFor="registration-source" className="mb-2 block text-sm font-bold text-brand-teal">
                    Bạn biết workshop qua đâu? <span className="text-brand-accent">*</span>
                  </label>
                  <select
                    id="registration-source" name="source" required ref={sourceRef}
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="min-h-[52px] w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 text-[15px] font-medium text-brand-teal transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                  >
                    <option value="" disabled>— Chọn nguồn thông tin —</option>
                    {GUEST_SOURCE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  {source === "Khác" && (
                    <input
                      id="registration-source-detail" name="sourceDetail" aria-label="Ghi rõ nguồn thông tin" required ref={sourceDetailRef}
                      value={sourceDetail}
                      onChange={(e) => setSourceDetail(e.target.value)}
                      placeholder="Vui lòng ghi rõ"
                      className="mt-3 min-h-[52px] w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 text-[15px] font-medium text-brand-teal transition placeholder:text-[#7BA4AA] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                    />
                  )}
                  {errSource && <div className="mt-1.5 text-xs font-semibold text-red-600">{errSource}</div>}
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="mt-2 min-h-[56px] w-full rounded-2xl bg-brand px-5 py-4 text-[15px] font-extrabold tracking-[0.03em] text-brand-teal shadow-[0_16px_32px_rgba(0,183,204,0.23)] transition hover:bg-brand-accent disabled:cursor-not-allowed disabled:bg-[#7AA5A8] disabled:text-white disabled:shadow-none"
                >
                  {busy ? "Đang gửi đăng ký..." : "Gửi đăng ký"}
                </button>

                <p className="text-center text-xs leading-5 text-[#5A8A92]">
                  Hi Sweetie Việt Nam chỉ sử dụng thông tin này để xác nhận workshop và hỗ trợ khách tham dự.
                </p>
              </form>
            </>
          )}

          {step === "success" && (
            <StateCard
              tone={registrationStatus === "confirmed" ? "success" : "warning"}
              label={registrationStatus === "confirmed" ? "Đã xác nhận" : "Chờ xác nhận"}
              title={registrationStatus === "confirmed" ? "Đăng ký thành công" : "Đăng ký đã được tiếp nhận"}
              description={registrationStatus === "confirmed"
                ? [
                    `Cảm ơn ${fullName.trim() || "quý khách"} đã đăng ký tham gia workshop.`,
                    "Suất tham dự của bạn đã được xác nhận.",
                    "Thông tin xác nhận đã được gửi qua Zalo. Vui lòng kiểm tra tin nhắn để biết thêm chi tiết.",
                  ]
                : [
                    `Cảm ơn ${fullName.trim() || "quý khách"} đã đăng ký tham gia workshop.`,
                    "Thông tin đăng ký của bạn đã được tiếp nhận và đang chờ xác nhận từ ban tổ chức.",
                    "Bạn sẽ nhận được thông báo qua Zalo ngay khi đăng ký được xác nhận.",
                  ]}
              details={[
                ["Workshop", selectedWorkshop?.name || "—"],
                ["Số khách đăng ký", String(Math.max(1, Math.floor(partySize) || 1))],
              ]}
            />
          )}

          {step === "closed" && (
            <StateCard
              tone="warning"
              label="Form đã đóng"
              title="Workshop hiện chưa nhận đăng ký"
              description="Form đăng ký này hiện đã đóng hoặc chưa được mở. Vui lòng liên hệ ban tổ chức để được hỗ trợ thông tin workshop phù hợp."
              details={[["Hotline", "0973 123 230"], ["Thương hiệu", "Hi Sweetie Việt Nam"]]}
            />
          )}

          {step === "error" && (
            <StateCard
              tone="error"
              label="Không thể tải form"
              title="Link đăng ký không khả dụng"
              description={errMsg || "Vui lòng kiểm tra lại link đăng ký hoặc liên hệ ban tổ chức để được hỗ trợ."}
              details={[["Hotline", "0973 123 230"], ["Đường dẫn", "/register/:token"]]}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function StateCard({
  tone,
  label,
  title,
   description,
  details,
}: {
  tone: "success" | "warning" | "error";
  label: string;
  title: string;
  description: string | string[];
  details: Array<[string, string]>;
}) {
  const toneClass = {
    success: "bg-[#2E8B8F]/10 text-[#2E8B8F] border-[#2E8B8F]/20",
    warning: "bg-[#C9A84C]/15 text-[#8A6A1D] border-[#C9A84C]/25",
    error: "bg-red-50 text-red-700 border-red-200",
  }[tone];

  return (
    <div className="py-4 text-center sm:py-8">
      <div className={`mx-auto mb-5 inline-flex rounded-full border px-3 py-1 text-xs font-extrabold uppercase tracking-[0.1em] ${toneClass}`}>
        {label}
      </div>
       <h1 className="font-heading text-3xl font-bold leading-tight tracking-[-0.035em] text-brand-teal">
         {title}
       </h1>
       <div className="mx-auto mt-3 max-w-md space-y-2 text-sm leading-7 text-[#3A6B74]">
         {(Array.isArray(description) ? description : [description]).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
       </div>
      <div className="mt-6 grid gap-3 text-left">
        {details.map(([name, value]) => (
          <div key={name} className="rounded-2xl border border-line bg-[#F5FAFB] p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#5A8A92]">{name}</div>
             {name === "Hotline" ? (
               <a href="tel:0973123230" className="mt-1 inline-block text-sm font-semibold text-brand-teal underline">{value}</a>
             ) : (
               <div className="mt-1 text-sm font-semibold text-brand-teal">{value}</div>
             )}
          </div>
        ))}
      </div>
    </div>
  );
}
