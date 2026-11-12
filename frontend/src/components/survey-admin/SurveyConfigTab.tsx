"use client";

import { useEffect, useRef, useState } from "react";
import { fromLocalInput, surveyAdminApi, toLocalInput, type SurveyEnvelope, type SurveySettingsAdmin } from "@/lib/survey-admin";

const CONTENT_FIELDS: { key: string; label: string; multiline?: boolean; hint?: string }[] = [
  { key: "brand_line", label: "Dòng thương hiệu (chữ hoa nhỏ trên tiêu đề)" },
  { key: "tagline", label: "Khẩu hiệu" },
  { key: "greeting", label: "Lời chào ở màn nhận diện", multiline: true },
  { key: "phone_helper", label: "Giải thích mục đích dùng số điện thoại", multiline: true },
  { key: "hotline", label: "Hotline hỗ trợ" },
  { key: "email", label: "Email hỗ trợ" },
  { key: "thank_you", label: "Lời cảm ơn sau khi gửi", multiline: true },
  { key: "signature", label: "Chữ ký team" },
  { key: "impressions_title", label: "Câu hỏi 02 · Cảm nhận" },
  { key: "impressions_hint", label: "Gợi ý câu 02", multiline: true },
  { key: "discomfort_title", label: "Câu hỏi 03 · Góp ý" },
  { key: "discomfort_hint", label: "Gợi ý câu 03", multiline: true },
  { key: "expectation_title", label: "Câu hỏi 04 · Kỳ vọng" },
  { key: "rating_title", label: "Câu hỏi 05 · Hài lòng" },
];
const QUESTIONS: { key: string; label: string }[] = [
  { key: "favorites", label: "01 · Chọn món yêu thích" }, { key: "product_notes", label: "01 · Nhận xét riêng từng món" },
  { key: "impressions", label: "02 · Tính từ cảm nhận" }, { key: "discomfort", label: "03 · Điều chưa thoải mái" },
  { key: "expectation", label: "04 · Kỳ vọng" }, { key: "rating", label: "05 · Mức độ hài lòng" },
];

export default function SurveyConfigTab({ workshopId, env, canManage, onSaved, onError }: {
  workshopId: string; env: SurveyEnvelope; canManage: boolean; onSaved: (t: string) => Promise<void>; onError: (t: string) => void;
}) {
  const s = env.survey;
  const base = s || { slug: env.defaults?.slug || "", title: env.defaults?.title || "", content: env.defaults?.content || {}, settings: env.defaults?.settings as SurveySettingsAdmin, opens_at: null, closes_at: null };
  const [slug, setSlug] = useState(base.slug);
  const [title, setTitle] = useState(base.title);
  const [opens, setOpens] = useState(toLocalInput(base.opens_at));
  const [closes, setCloses] = useState(toLocalInput(base.closes_at));
  const [content, setContent] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(base.content || {}).map(([k, v]) => [k, v || ""])));
  const [settings, setSettings] = useState<SurveySettingsAdmin>(base.settings);
  const [adjText, setAdjText] = useState((base.settings?.adjectives || []).join("\n"));
  const [tagText, setTagText] = useState((base.settings?.note_tags || []).join("\n"));
  const [busy, setBusy] = useState(false);
  const heroRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setSlug(base.slug); setTitle(base.title); }, [s?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    try {
      const { hero_image_url: _hero, ...rest } = content;
      void _hero;
      await surveyAdminApi.save(workshopId, {
        slug, title, opens_at: fromLocalInput(opens), closes_at: fromLocalInput(closes), content: rest,
        settings: { ...settings, adjectives: adjText.split("\n").map((x) => x.trim()).filter(Boolean), note_tags: tagText.split("\n").map((x) => x.trim()).filter(Boolean) },
      });
      await onSaved(s ? "Đã lưu cấu hình — bấm “Xuất bản thay đổi” để khách thấy bản mới" : "Đã tạo khảo sát. Tiếp theo: chọn món ở tab “Món & nhóm”.");
    } catch (e: any) { onError(e?.message || "Lưu thất bại"); } finally { setBusy(false); }
  };
  const uploadHero = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try { const r = await surveyAdminApi.uploadHero(workshopId, file); setContent((c) => ({ ...c, hero_image_url: r.hero_image_url })); await onSaved("Đã cập nhật ảnh bìa"); }
    catch (e: any) { onError(e?.message || "Tải ảnh thất bại"); } finally { setBusy(false); }
  };
  const input = "mt-1 min-h-11 w-full rounded-md border border-line bg-surface px-3 font-normal";
  const ro = !canManage || busy;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <section className="rounded-md border border-line bg-surface p-4">
          <h2 className="mb-3 font-heading text-base font-bold text-brand-teal">Thông tin chung</h2>
          {!s && <p className="mb-3 rounded-md bg-cyan-bg px-3 py-2 text-sm">Workshop này chưa có khảo sát. Điền thông tin rồi bấm <b>Tạo khảo sát</b>.</p>}
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <label className="font-semibold sm:col-span-2">Tiêu đề hiển thị cho khách<input value={title} onChange={(e) => setTitle(e.target.value)} disabled={ro} maxLength={200} className={input} /></label>
            <label className="font-semibold sm:col-span-2">Đường dẫn công khai
              <div className="mt-1 flex items-center rounded-md border border-line bg-surface-muted text-muted">
                <span className="px-3">/survey/</span>
                <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} disabled={ro} maxLength={80} className="min-h-11 flex-1 rounded-r-md bg-surface px-2 font-normal text-ink" />
              </div>
              <span className="mt-1 block text-xs font-normal text-muted">Chỉ chữ thường không dấu, số và dấu gạch. Đổi slug sau khi đã in QR sẽ làm QR cũ không dùng được.</span>
            </label>
            <label className="font-semibold">Mở nhận phiếu từ<input type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} disabled={ro} className={input} /></label>
            <label className="font-semibold">Tự đóng lúc<input type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} disabled={ro} className={input} /></label>
            <p className="text-xs font-normal text-muted sm:col-span-2">Để trống = mở ngay khi xuất bản / chỉ đóng khi bấm “Đóng nhận phiếu”.</p>
          </div>
        </section>

        <section className="rounded-md border border-line bg-surface p-4">
          <h2 className="mb-3 font-heading text-base font-bold text-brand-teal">Nội dung hiển thị</h2>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            {CONTENT_FIELDS.map((f) => (
              <label key={f.key} className={`font-semibold ${f.multiline ? "sm:col-span-2" : ""}`}>{f.label}
                {f.multiline
                  ? <textarea value={content[f.key] || ""} onChange={(e) => setContent({ ...content, [f.key]: e.target.value })} disabled={ro} rows={2} maxLength={600} className="mt-1 w-full rounded-md border border-line px-3 py-2 font-normal" />
                  : <input value={content[f.key] || ""} onChange={(e) => setContent({ ...content, [f.key]: e.target.value })} disabled={ro} maxLength={600} className={input} />}
              </label>
            ))}
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <section className="rounded-md border border-line bg-surface p-4 text-sm">
          <h2 className="mb-3 font-heading text-base font-bold text-brand-teal">Ảnh bìa màn nhận diện</h2>
          <img src={content.hero_image_url || "/survey/hero-default.jpg"} alt="Ảnh bìa" className="mb-2 h-36 w-full rounded-md object-cover" />
          {s && canManage && (
            <>
              <input ref={heroRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void uploadHero(e.target.files?.[0])} />
              <button type="button" disabled={busy} onClick={() => heroRef.current?.click()} className="min-h-10 rounded-md border border-brand px-3 font-semibold text-brand-accent">Đổi ảnh bìa</button>
            </>
          )}
        </section>
        <section className="rounded-md border border-line bg-surface p-4 text-sm">
          <h2 className="mb-3 font-heading text-base font-bold text-brand-teal">Câu hỏi</h2>
          <div className="space-y-2">
            {QUESTIONS.map((q) => (
              <label key={q.key} className="flex min-h-9 items-center gap-2">
                <input type="checkbox" checked={settings?.questions?.[q.key] ?? true} disabled={ro}
                  onChange={(e) => setSettings({ ...settings, questions: { ...settings.questions, [q.key]: e.target.checked } })} className="h-4 w-4" />
                {q.label}
              </label>
            ))}
            <label className="flex min-h-9 items-center gap-2 border-t border-line pt-2">
              <input type="checkbox" checked={settings?.rating_required ?? true} disabled={ro || !settings?.questions?.rating}
                onChange={(e) => setSettings({ ...settings, rating_required: e.target.checked })} className="h-4 w-4" />
              Bắt buộc chấm sao trước khi gửi
            </label>
            <label className="flex items-center gap-2">Số ô “Khác” cho tính từ
              <select value={settings?.custom_adjective_slots ?? 2} disabled={ro} onChange={(e) => setSettings({ ...settings, custom_adjective_slots: Number(e.target.value) })} className="min-h-9 rounded-md border border-line px-2">
                {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        </section>
        <section className="rounded-md border border-line bg-surface p-4 text-sm">
          <label className="block font-semibold">Danh sách tính từ (mỗi dòng một tính từ)
            <textarea value={adjText} onChange={(e) => setAdjText(e.target.value)} disabled={ro} rows={7} className="mt-1 w-full rounded-md border border-line px-3 py-2 font-normal" />
          </label>
          <label className="mt-3 block font-semibold">Tag gợi ý nhận xét món (mỗi dòng một tag)
            <textarea value={tagText} onChange={(e) => setTagText(e.target.value)} disabled={ro} rows={5} className="mt-1 w-full rounded-md border border-line px-3 py-2 font-normal" />
          </label>
        </section>
        {canManage && (
          <button type="button" onClick={save} disabled={busy} className="min-h-11 w-full rounded-md bg-brand px-4 text-sm font-semibold text-brand-teal disabled:opacity-60">
            {busy ? "Đang lưu…" : s ? "Lưu cấu hình" : "Tạo khảo sát"}
          </button>
        )}
      </div>
    </div>
  );
}
