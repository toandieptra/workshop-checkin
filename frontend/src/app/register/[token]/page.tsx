"use client";
import { useEffect, useState } from "react";
import {
  getPublicRegistrationForm,
  submitPublicRegistrationForm,
  type RegistrationFormPublic,
} from "@/lib/api";

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

  // Fields
  const [workshopId, setWorkshopId] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState(1);
  const [businessModel, setBusinessModel] = useState("");

  // Field-level errors
  const [errWorkshop, setErrWorkshop] = useState("");
  const [errName, setErrName] = useState("");
  const [errPhone, setErrPhone] = useState("");
  const [errParty, setErrParty] = useState("");

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
        const firstWorkshopId = f.workshops?.[0]?.id || f.workshop_id;
        setWorkshopId(firstWorkshopId || "");
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

    return ok;
  };

  const submit = async () => {
    if (busy) return;
    if (!validate()) return;
    setBusy(true);
    setErrMsg("");
    try {
      await submitPublicRegistrationForm(token, {
        workshop_id: workshopId,
        full_name: fullName.trim(),
        phone: normalizePhone(phone),
        party_size: Math.max(1, Math.floor(partySize) || 1),
        business_model: businessModel.trim() || undefined,
      });
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
      <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-4 pb-6 sm:pb-8">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-[14px] bg-[radial-gradient(circle_at_50%_30%,#1A5F6A,#0D3B42)] font-heading text-sm font-extrabold tracking-[-0.05em] text-white shadow-[0_12px_26px_rgba(13,59,66,0.22)]">
            HS
          </div>
          <div>
            <div className="font-heading text-base font-bold leading-tight tracking-[0.02em]">Hi Sweetie Việt Nam</div>
            <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[#3A6B74]">Workshop Check-in</div>
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-brand/25 bg-white/75 px-4 py-2 text-xs font-semibold text-brand-teal shadow-sm backdrop-blur sm:inline-flex">
          <span className="h-2 w-2 rounded-full bg-brand shadow-[0_0_0_5px_rgba(0,183,204,0.12)]" />
          Hotline: 0973 123 230
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-xl justify-center">
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
              <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.12em] text-brand-accent">/register/:token</p>
              <h2 className="font-heading text-3xl font-bold leading-tight tracking-[-0.035em] text-brand-teal sm:text-[34px]">
                Thông tin đăng ký
              </h2>
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
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
                  {errMsg}
                </div>
              )}

              <div className="mt-6 space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-bold text-brand-teal">
                    Workshop <span className="text-brand-accent">*</span>
                  </label>
                  <select
                    value={workshopId}
                    onChange={(e) => setWorkshopId(e.target.value)}
                    className="min-h-[52px] w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 text-[15px] font-medium text-brand-teal transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                  >
                    {workshopOptions.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}{w.event_date ? " — " + w.event_date : ""}
                      </option>
                    ))}
                  </select>
                  {errWorkshop && <div className="mt-1.5 text-xs font-semibold text-red-600">{errWorkshop}</div>}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-brand-teal">
                    Họ và tên <span className="text-brand-accent">*</span>
                  </label>
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nguyễn Văn A"
                    className="min-h-[52px] w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 text-[15px] font-medium text-brand-teal transition placeholder:text-[#7BA4AA] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                  />
                  {errName && <div className="mt-1.5 text-xs font-semibold text-red-600">{errName}</div>}
                </div>

                <div className="grid gap-4 sm:grid-cols-[1fr_0.72fr]">
                  <div>
                    <label className="mb-2 block text-sm font-bold text-brand-teal">
                      Số điện thoại <span className="text-brand-accent">*</span>
                    </label>
                    <input
                      inputMode="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="0909 123 456"
                      className="min-h-[52px] w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 font-mono text-[15px] font-medium text-brand-teal transition placeholder:text-[#7BA4AA] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                    />
                    <div className="mt-1.5 text-xs leading-5 text-[#5A8A92]">Dùng để xác nhận suất tham dự.</div>
                    {errPhone && <div className="mt-1.5 text-xs font-semibold text-red-600">{errPhone}</div>}
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold text-brand-teal">
                      Số khách <span className="text-brand-accent">*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={partySize}
                      onChange={(e) => setPartySize(parseInt(e.target.value) || 1)}
                      className="min-h-[52px] w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 font-mono text-lg font-medium text-brand-teal transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                    />
                    <div className="mt-1.5 text-xs leading-5 text-[#5A8A92]">Số người tham dự.</div>
                    {errParty && <div className="mt-1.5 text-xs font-semibold text-red-600">{errParty}</div>}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-brand-teal">
                    Mô hình kinh doanh
                  </label>
                  <input
                    value={businessModel}
                    onChange={(e) => setBusinessModel(e.target.value)}
                    placeholder="Quán trà sữa, cafe, chuỗi F&B..."
                    className="min-h-[52px] w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 text-[15px] font-medium text-brand-teal transition placeholder:text-[#7BA4AA] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                  />
                  <div className="mt-1.5 text-xs leading-5 text-[#5A8A92]">
                    Hãy cho chúng tôi thêm thông tin về mô hình bạn đang kinh doanh.
                  </div>
                </div>

                <button
                  onClick={submit}
                  disabled={busy}
                  className="mt-2 min-h-[56px] w-full rounded-2xl bg-brand px-5 py-4 text-[15px] font-extrabold tracking-[0.03em] text-white shadow-[0_16px_32px_rgba(0,183,204,0.23)] transition hover:bg-brand-teal active:scale-[0.985] disabled:cursor-not-allowed disabled:bg-[#7AA5A8] disabled:shadow-none"
                >
                  {busy ? "Đang gửi đăng ký..." : "Gửi đăng ký"}
                </button>

                <p className="text-center text-xs leading-5 text-[#5A8A92]">
                  Hi Sweetie Việt Nam chỉ sử dụng thông tin này để xác nhận workshop và hỗ trợ khách tham dự.
                </p>
              </div>
            </>
          )}

          {step === "success" && (
            <StateCard
              tone="success"
              label="Đăng ký thành công"
              title="Thông tin đã được ghi nhận"
              description={`Cảm ơn ${fullName.trim() || "quý khách"}. Đội ngũ Hi Sweetie Việt Nam sẽ dùng số điện thoại đã cung cấp để xác nhận suất tham dự.`}
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
  description: string;
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
      <h2 className="font-heading text-3xl font-bold leading-tight tracking-[-0.035em] text-brand-teal">
        {title}
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[#3A6B74]">
        {description}
      </p>
      <div className="mt-6 grid gap-3 text-left">
        {details.map(([name, value]) => (
          <div key={name} className="rounded-2xl border border-line bg-[#F5FAFB] p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#5A8A92]">{name}</div>
            <div className="mt-1 text-sm font-semibold text-brand-teal">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}