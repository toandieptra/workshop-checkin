"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  getWorkshop,
  getWorkshopLandingContent,
  publishWorkshopLandingContent,
  saveWorkshopLandingContent,
  uploadWorkshopMedia,
  type WorkshopAdmin,
  type WorkshopMedia,
} from "@/lib/api";
import {
  buildDefaultContent,
  normalizeLandingContent,
  type LandingContent,
  type LandingHighlightCard,
  type LandingImage,
  type LandingProgramItem,
} from "@/components/landing/types";
import { formatEventDate, formatTimestamp } from "@/lib/date-format";

const VIEWPORTS = [
  { id: "desktop", label: "Desktop", width: 0 },
  { id: "tablet", label: "Tablet", width: 768 },
  { id: "mobile", label: "Mobile", width: 390 },
] as const;

type ViewportId = (typeof VIEWPORTS)[number]["id"];

const inputClass =
  "w-full rounded-sm border border-line bg-white px-2.5 py-2 text-sm text-brand-teal outline-none transition focus:border-brand";

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group rounded-md border border-line bg-surface" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-brand-teal">
        <span>{title}</span>
        <span className="text-muted transition group-open:rotate-180" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="space-y-3 border-t border-line px-3 py-3">{children}</div>
    </details>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

function ImageField({
  label,
  image,
  media,
  onUpload,
  onChange,
}: {
  label: string;
  image: LandingImage;
  media: WorkshopMedia[];
  onUpload: (file: File) => Promise<string | null>;
  onChange: (image: LandingImage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-sm border border-line p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-secondary">{label}</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            className="rounded-sm border border-line px-2 py-1 text-[11px] font-semibold text-brand-teal"
            onClick={() => setOpen((value) => !value)}
          >
            Thư viện
          </button>
          <button
            type="button"
            className="rounded-sm border border-line px-2 py-1 text-[11px] font-semibold text-brand-teal disabled:opacity-50"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "Đang tải…" : "Tải ảnh"}
          </button>
        </div>
      </div>

      <div className="mt-2 flex gap-2">
        {image.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt=""
            className="h-14 w-20 shrink-0 rounded-sm border border-line object-cover"
          />
        ) : (
          <div className="grid h-14 w-20 shrink-0 place-items-center rounded-sm border border-dashed border-line text-center text-[10px] text-muted">
            Chưa có ảnh
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <input
            className={inputClass}
            value={image.url}
            placeholder="URL ảnh"
            onChange={(event) => onChange({ ...image, url: event.target.value })}
          />
          <input
            className={inputClass}
            value={image.alt || ""}
            placeholder="Alt text (mô tả ảnh)"
            onChange={(event) => onChange({ ...image, alt: event.target.value })}
          />
        </div>
      </div>

      {open && (
        <div className="mt-2 grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto rounded-sm border border-line p-1.5">
          {media.length === 0 && (
            <span className="col-span-4 py-2 text-center text-[11px] text-muted">
              Chưa có ảnh trong thư viện workshop.
            </span>
          )}
          {media.map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.file_name || ""}
              onClick={() => {
                onChange({ ...image, url: item.file_url });
                setOpen(false);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.file_url}
                alt=""
                className="h-12 w-full rounded-sm border border-line object-cover"
              />
            </button>
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setUploading(true);
          try {
            const url = await onUpload(file);
            if (url) onChange({ ...image, url });
          } finally {
            setUploading(false);
          }
        }}
      />
    </div>
  );
}

function ImageListEditor({
  images,
  onUpload,
  onChange,
}: {
  images: LandingImage[];
  onUpload: (file: File) => Promise<string | null>;
  onChange: (images: LandingImage[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadIndexRef = useRef<number | null>(null);
  const [uploading, setUploading] = useState(false);

  const chooseFile = (index: number | null) => {
    uploadIndexRef.current = index;
    fileRef.current?.click();
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const url = await onUpload(file);
      const index = uploadIndexRef.current;
      if (url) {
        onChange(index === null
          ? [...images, { url, alt: "" }]
          : images.map((item, itemIndex) => itemIndex === index ? { ...item, url } : item));
      }
    } finally {
      setUploading(false);
      uploadIndexRef.current = null;
    }
  };

  return (
    <fieldset className="min-w-0 space-y-1.5" disabled={uploading} aria-busy={uploading}>
      {images.map((image, index) => (
        <div key={index} className="flex items-center gap-1.5">
          {image.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.url}
              alt=""
              className="h-9 w-14 shrink-0 rounded-sm border border-line object-cover"
            />
          ) : (
            <div className="h-9 w-14 shrink-0 rounded-sm border border-dashed border-line" />
          )}
          <input
            className={inputClass}
            value={image.url}
            placeholder="URL ảnh/GIF"
            onChange={(event) =>
              onChange(
                images.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, url: event.target.value } : item,
                ),
              )
            }
          />
          <button
            type="button"
            className="shrink-0 rounded-sm border border-line px-2 py-1 text-[11px] font-semibold text-brand-teal disabled:opacity-50"
            disabled={uploading}
            aria-label={`Tải ảnh thay thế ảnh ${index + 1}`}
            onClick={() => chooseFile(index)}
          >
            Tải ảnh
          </button>
          <button
            type="button"
            aria-label={`Xóa ảnh ${index + 1}`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-line text-muted hover:text-error"
            onClick={() => onChange(images.filter((_, itemIndex) => itemIndex !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="w-full rounded-sm border border-dashed border-line py-1.5 text-xs font-semibold text-brand-teal"
        onClick={() => chooseFile(null)}
      >
        {uploading ? "Đang tải…" : "Tải ảnh lên"}
      </button>
      <button
        type="button"
        className="w-full rounded-sm border border-dashed border-line py-1.5 text-xs font-semibold text-brand-teal"
        onClick={() => onChange([...images, { url: "", alt: "" }])}
      >
        + Thêm ảnh bằng URL
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) await handleFile(file);
        }}
      />
    </fieldset>
  );
}

export default function LandingBuilderPage({ params }: { params: { id: string } }) {
  const workshopId = params.id;
  const { canForWorkshop } = useAuth();
  const canEdit = canForWorkshop(PERMISSIONS.workshopsEdit, workshopId);

  const [workshop, setWorkshop] = useState<WorkshopAdmin | null>(null);
  const [content, setContent] = useState<LandingContent | null>(null);
  const [baseline, setBaseline] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [toast, setToast] = useState("");
  const [viewport, setViewport] = useState<ViewportId>("desktop");
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let active = true;
    setWorkshop(null);
    setContent(null);
    setLoadError("");
    if (!canEdit) return;
    Promise.all([getWorkshop(workshopId), getWorkshopLandingContent(workshopId)])
      .then(([workshopData, contentData]) => {
        if (!active) return;
        setWorkshop(workshopData);
        setPublishedAt(contentData.published_at ?? null);
        const defaults = buildDefaultContent({
          name: workshopData.name,
          eventDate: workshopData.event_date,
          eventTime: workshopData.event_time,
          location: workshopData.location,
        });
        const initial = normalizeLandingContent(contentData.draft_content ?? null, defaults);
        setContent(initial);
        setBaseline(JSON.stringify(initial));
        if (contentData.draft_content) setLastSavedAt(contentData.updated_at ?? null);
      })
      .catch((error) =>
        active && setLoadError(error instanceof ApiError ? error.message : "Không tải được dữ liệu builder."),
      );
    return () => {
      active = false;
    };
  }, [workshopId, canEdit]);

  const dirty = useMemo(
    () => (content ? JSON.stringify(content) !== baseline : false),
    [content, baseline],
  );

  // Đẩy nội dung đang sửa sang iframe preview (debounce nhẹ)
  useEffect(() => {
    if (!content) return;
    const timer = window.setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "landing-preview-content", content },
        window.location.origin,
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [content]);

  const pushToPreview = useCallback(() => {
    if (!content) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "landing-preview-content", content },
      window.location.origin,
    );
  }, [content]);

  // Cảnh báo rời trang khi còn thay đổi chưa lưu
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "landing-preview-register") {
        setToast("Nút đăng ký sẽ mở form đăng ký ở trang công khai.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleBack = useCallback(
    (event: React.MouseEvent) => {
      if (dirty && !window.confirm("Bạn có thay đổi chưa lưu. Rời trang và bỏ các thay đổi?")) {
        event.preventDefault();
      }
    },
    [dirty],
  );

  const handleUpload = useCallback(
    async (file: File): Promise<string | null> => {
      if (!canEdit) return null;
      try {
        const created = await uploadWorkshopMedia(workshopId, [file], "banner");
        const media = created[0];
        if (!media) return null;
        setWorkshop((current) =>
          current ? { ...current, media: [...current.media, media] } : current,
        );
        return media.file_url;
      } catch {
        setToast("Không thể tải ảnh lên.");
        return null;
      }
    },
    [workshopId, canEdit],
  );

  const handleSave = useCallback(async () => {
    if (!canEdit || !content || saveState === "saving") return;
    setSaveState("saving");
    try {
      const result = await saveWorkshopLandingContent(
        workshopId,
        content as unknown as Record<string, unknown>,
      );
      setBaseline(JSON.stringify(content));
      setLastSavedAt(result.updated_at ?? new Date().toISOString());
      setSaveState("saved");
      setToast("Đã lưu nháp");
    } catch (error) {
      setSaveState("error");
      setToast(
        error instanceof ApiError ? `Không thể lưu nháp: ${error.message}` : "Không thể lưu nháp. Vui lòng thử lại.",
      );
    }
  }, [content, saveState, workshopId, canEdit]);

  const handlePublish = useCallback(async () => {
    if (!canEdit || !content || publishing) return;
    setPublishing(true);
    setPublishError("");
    try {
      if (dirty) {
        const saved = await saveWorkshopLandingContent(
          workshopId,
          content as unknown as Record<string, unknown>,
        );
        setBaseline(JSON.stringify(content));
        setLastSavedAt(saved.updated_at ?? new Date().toISOString());
        setSaveState("saved");
      }
      const result = await publishWorkshopLandingContent(workshopId);
      setPublishedAt(result.published_at ?? new Date().toISOString());
      setToast("Đã xuất bản landing page");
    } catch (error) {
      setPublishError(
        error instanceof ApiError ? error.message : "Không thể xuất bản. Vui lòng thử lại.",
      );
    } finally {
      setPublishing(false);
    }
  }, [content, publishing, dirty, workshopId, canEdit]);

  const updateHero = (patch: Partial<LandingContent["hero"]>) =>
    setContent((current) => (current ? { ...current, hero: { ...current.hero, ...patch } } : current));

  const updateAbout = (patch: Partial<LandingContent["about"]>) =>
    setContent((current) => (current ? { ...current, about: { ...current.about, ...patch } } : current));

  const updateProgram = (patch: Partial<LandingContent["program"]>) =>
    setContent((current) =>
      current ? { ...current, program: { ...current.program, ...patch } } : current,
    );

  const updateHighlights = (patch: Partial<LandingContent["highlights"]>) =>
    setContent((current) =>
      current ? { ...current, highlights: { ...current.highlights, ...patch } } : current,
    );

  const updateSeo = (patch: Partial<LandingContent["seo"]>) =>
    setContent((current) => (current ? { ...current, seo: { ...current.seo, ...patch } } : current));

  const setProgramItem = (index: number, patch: Partial<LandingProgramItem>) =>
    setContent((current) => {
      if (!current) return current;
      const items = current.program.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      );
      return { ...current, program: { ...current.program, items } };
    });

  const moveProgramItem = (index: number, direction: -1 | 1) =>
    setContent((current) => {
      if (!current) return current;
      const items = [...current.program.items];
      const target = index + direction;
      if (target < 0 || target >= items.length) return current;
      [items[index], items[target]] = [items[target], items[index]];
      return { ...current, program: { ...current.program, items } };
    });

  const removeProgramItem = (index: number) =>
    setContent((current) => {
      if (!current) return current;
      const items = current.program.items.filter((_, itemIndex) => itemIndex !== index);
      return { ...current, program: { ...current.program, items } };
    });

  const setHighlightCard = (index: number, patch: Partial<LandingHighlightCard>) =>
    setContent((current) => {
      if (!current) return current;
      const cards = current.highlights.cards.map((card, cardIndex) =>
        cardIndex === index ? { ...card, ...patch } : card,
      );
      return { ...current, highlights: { ...current.highlights, cards } };
    });

  if (!canEdit) return <div className="p-8 text-center text-muted">Bạn không có quyền chỉnh sửa landing page của workshop này.</div>;

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="font-heading text-lg font-bold text-brand-teal">Không thể mở builder</h1>
        <p className="mt-2 text-sm text-muted">{loadError}</p>
        <Link href="/admin/workshop" className="mt-4 inline-block text-sm font-semibold text-brand underline">
          ← Về danh sách workshop
        </Link>
      </div>
    );
  }

  if (!workshop || !content) {
    return <div className="px-4 py-16 text-center text-sm text-muted">Đang tải builder…</div>;
  }

  const statusDot =
    saveState === "saving"
      ? "bg-warning"
      : saveState === "error"
        ? "bg-error"
        : dirty
          ? "bg-warning"
          : "bg-success";
  const statusText =
    saveState === "saving"
      ? "Đang lưu nháp…"
      : saveState === "error"
        ? "Lưu nháp thất bại"
        : dirty
          ? "Có thay đổi chưa lưu"
          : lastSavedAt
            ? `Đã lưu nháp lúc ${formatTimestamp(lastSavedAt)}`
            : "Chưa lưu nháp";

  const media = (workshop.media || []).filter(
    (item) =>
      (item.mime_type || "").startsWith("image/") ||
      /\.(jpe?g|png|webp|heic|heif)$/i.test(item.file_url),
  );
  const linkedForm = workshop.registration_forms?.find(
    (form) => form.id === workshop.landing_registration_form_id,
  );
  const activeViewport = VIEWPORTS.find((item) => item.id === viewport) ?? VIEWPORTS[0];

  return (
    <div className="min-h-screen bg-cyan-bg/40">
      <div className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-3 py-2.5 sm:px-5">
          <Link
            href="/admin/workshop"
            onClick={handleBack}
            className="grid min-h-9 place-items-center rounded-md border border-line px-2.5 text-sm font-semibold text-brand-teal"
          >
            ← Workshop
          </Link>
          <h1 className="min-w-0 flex-1 truncate font-heading text-sm font-bold text-brand-teal">
            {workshop.name}
            <span className="ml-1 font-sans text-xs font-medium text-muted">· Landing page</span>
          </h1>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className={`h-2 w-2 rounded-full ${statusDot}`} aria-hidden="true" />
            {statusText}
          </span>
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === "saving"}
            className="min-h-9 rounded-md border border-brand bg-brand/10 px-3 text-sm font-semibold text-brand-teal disabled:opacity-60"
          >
            {saveState === "saving" ? "Đang lưu…" : "Lưu nháp"}
          </button>
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing}
            className="min-h-9 rounded-md bg-brand px-3 text-sm font-semibold text-brand-teal disabled:opacity-60"
          >
            {publishing ? "Đang xuất bản…" : publishedAt ? "Cập nhật bản đã xuất bản" : "Xuất bản"}
          </button>
          {publishedAt ? (
            <a
              href={`/workshops/${workshop.slug}`}
              target="_blank"
              rel="noreferrer"
              className="grid min-h-9 place-items-center rounded-md border border-line px-3 text-sm font-semibold text-brand-teal"
            >
              Xem trang công khai ↗
            </a>
          ) : (
            <span className="grid min-h-9 place-items-center rounded-md border border-dashed border-line px-3 text-xs text-muted">
              Chưa xuất bản
            </span>
          )}
        </div>
        {publishError && (
          <div className="border-t border-error/30 bg-error/10 px-3 py-2 text-xs font-medium text-error sm:px-5">
            Không thể xuất bản: {publishError}
          </div>
        )}
      </div>

      <div className="mx-auto max-w-[1600px] px-3 pt-3 sm:px-5 lg:hidden">
        <div className="flex gap-1 rounded-md border border-line bg-surface p-1">
          {(["edit", "preview"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMobileTab(tab)}
              aria-pressed={mobileTab === tab}
              className={`min-h-9 flex-1 rounded-sm text-sm font-semibold ${
                mobileTab === tab ? "bg-brand text-brand-teal" : "text-muted"
              }`}
            >
              {tab === "edit" ? "Chỉnh sửa" : "Xem trước"}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-[1600px] gap-3 px-3 py-3 sm:px-5 lg:grid-cols-[420px_minmax(0,1fr)]">
        <div className={`${mobileTab === "edit" ? "block" : "hidden"} space-y-2 lg:block`}>
          <Section title="Thông tin cơ bản" defaultOpen>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div className="col-span-2">
                <dt className="text-muted">Tên workshop</dt>
                <dd className="mt-0.5 font-medium text-brand-teal">{workshop.name}</dd>
              </div>
              <div>
                <dt className="text-muted">Ngày</dt>
                <dd className="mt-0.5 font-medium text-brand-teal">
                  {workshop.event_date ? formatEventDate(workshop.event_date) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Giờ</dt>
                <dd className="mt-0.5 font-medium text-brand-teal">
                  {workshop.event_time ? workshop.event_time.slice(0, 5) : "—"}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">Địa điểm</dt>
                <dd className="mt-0.5 font-medium text-brand-teal">{workshop.location || "—"}</dd>
              </div>
            </dl>
            <p className="text-[11px] leading-5 text-muted">
              Dữ liệu lấy từ workshop. Nội dung bạn chỉnh ở đây được giữ nguyên khi dữ liệu workshop
              thay đổi.
            </p>
          </Section>

          <Section title="Hero">
            <Field label="Tiêu đề hiển thị ngắn" hint="Nên ngắn gọn để vừa một dòng trên desktop.">
              <input
                className={inputClass}
                value={content.hero.displayTitle}
                onChange={(event) => updateHero({ displayTitle: event.target.value })}
              />
            </Field>
            <Field label="Tagline">
              <input
                className={inputClass}
                value={content.hero.tagline}
                onChange={(event) => updateHero({ tagline: event.target.value })}
              />
            </Field>
            <Field label="Mô tả ngắn (Hero)">
              <textarea
                className={`${inputClass} min-h-20`}
                value={content.hero.description}
                onChange={(event) => updateHero({ description: event.target.value })}
              />
            </Field>
            <ImageField
              label="Ảnh hero"
              image={content.hero.image}
              media={media}
              onUpload={handleUpload}
              onChange={(image) => updateHero({ image })}
            />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Nhãn CTA">
                <input
                  className={inputClass}
                  value={content.hero.ctaLabel}
                  onChange={(event) => updateHero({ ctaLabel: event.target.value })}
                />
              </Field>
              <Field label="URL CTA" hint="Để trống sẽ mở form đăng ký.">
                <input
                  className={inputClass}
                  value={content.hero.ctaHref || ""}
                  placeholder="https://… hoặc /duong-dan"
                  onChange={(event) => updateHero({ ctaHref: event.target.value })}
                />
              </Field>
            </div>
          </Section>

          <Section title="Marquee">
            <p className="text-[11px] leading-5 text-muted">
              Ảnh/GIF trang trí cho hai dải chạy theo scroll. Có thể thay bằng media thật của
              workshop.
            </p>
            <ImageListEditor
              images={content.marquee.images}
              onUpload={handleUpload}
              onChange={(images) =>
                setContent((current) => (current ? { ...current, marquee: { images } } : current))
              }
            />
          </Section>

          <Section title="Giới thiệu">
            <Field label="Tiêu đề">
              <input
                className={inputClass}
                value={content.about.heading}
                onChange={(event) => updateAbout({ heading: event.target.value })}
              />
            </Field>
            <Field label="Đoạn mô tả" hint={`${content.about.description.length} ký tự`}>
              <textarea
                className={`${inputClass} min-h-24`}
                value={content.about.description}
                onChange={(event) => updateAbout({ description: event.target.value })}
              />
            </Field>
            <Field label="Lời hứa workshop">
              <input
                className={inputClass}
                value={content.about.promise}
                onChange={(event) => updateAbout({ promise: event.target.value })}
              />
            </Field>
            <div>
              <span className="mb-1 block text-xs font-medium text-text-secondary">
                Ảnh trang trí (4 góc)
              </span>
              <ImageListEditor
                images={content.about.decorImages}
                onUpload={handleUpload}
                onChange={(decorImages) => updateAbout({ decorImages })}
              />
            </div>
          </Section>

          <Section title="Timeline Workshop">
            <Field label="Tiêu đề section">
              <input
                className={inputClass}
                value={content.program.heading}
                onChange={(event) => updateProgram({ heading: event.target.value })}
              />
            </Field>
            <div className="space-y-2">
              {content.program.items.map((item, index) => (
                <div key={index} className="rounded-sm border border-line p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-muted">
                      Mục {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label="Di chuyển lên"
                        disabled={index === 0}
                        className="grid h-7 w-7 place-items-center rounded-sm border border-line text-xs text-brand-teal disabled:opacity-40"
                        onClick={() => moveProgramItem(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label="Di chuyển xuống"
                        disabled={index === content.program.items.length - 1}
                        className="grid h-7 w-7 place-items-center rounded-sm border border-line text-xs text-brand-teal disabled:opacity-40"
                        onClick={() => moveProgramItem(index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label="Xóa mục"
                        className="grid h-7 w-7 place-items-center rounded-sm border border-line text-xs text-muted hover:text-error"
                        onClick={() => removeProgramItem(index)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    <input
                      className={inputClass}
                      value={item.title}
                      placeholder="Tiêu đề"
                      onChange={(event) => setProgramItem(index, { title: event.target.value })}
                    />
                    <textarea
                      className={`${inputClass} min-h-16`}
                      value={item.description}
                      placeholder="Mô tả"
                      onChange={(event) =>
                        setProgramItem(index, { description: event.target.value })
                      }
                    />
                    <input
                      className={inputClass}
                      value={item.meta || ""}
                      aria-label={`Khung giờ mục ${index + 1}`}
                      placeholder="Khung giờ (ví dụ: 13:00 – 14:30)"
                      onChange={(event) => setProgramItem(index, { meta: event.target.value })}
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="w-full rounded-sm border border-dashed border-line py-1.5 text-xs font-semibold text-brand-teal"
                onClick={() =>
                  updateProgram({
                    items: [...content.program.items, { title: "", description: "", meta: "" }],
                  })
                }
              >
                + Thêm mục
              </button>
            </div>
          </Section>

          <Section title="Điểm nổi bật">
            <Field label="Tiêu đề section">
              <input
                className={inputClass}
                value={content.highlights.heading}
                onChange={(event) => updateHighlights({ heading: event.target.value })}
              />
            </Field>
            <Field
              label="Kết quả có thể ứng dụng"
              hint="Mỗi dòng là một gợi ý ngắn; tối đa 4 dòng sẽ hiển thị trên landing page."
            >
              <div className="space-y-2">
                {content.highlights.outcomes.map((outcome, index) => (
                  <input
                    key={index}
                    className={inputClass}
                    value={outcome}
                    placeholder={`Gợi ý ${index + 1}`}
                    onChange={(event) =>
                      updateHighlights({
                        outcomes: content.highlights.outcomes.map((item, itemIndex) =>
                          itemIndex === index ? event.target.value : item,
                        ),
                      })
                    }
                  />
                ))}
              </div>
            </Field>
            {content.highlights.cards.map((card, index) => (
              <details key={index} className="rounded-sm border border-line">
                <summary className="cursor-pointer list-none px-2 py-2 text-xs font-semibold text-brand-teal">
                  Thẻ {String(index + 1).padStart(2, "0")}: {card.title || "(chưa có tiêu đề)"}
                </summary>
                <div className="space-y-2 border-t border-line p-2">
                  <input
                    className={inputClass}
                    value={card.category}
                    placeholder="Danh mục"
                    onChange={(event) => setHighlightCard(index, { category: event.target.value })}
                  />
                  <input
                    className={inputClass}
                    value={card.title}
                    placeholder="Tiêu đề thẻ"
                    onChange={(event) => setHighlightCard(index, { title: event.target.value })}
                  />
                  <textarea
                    className={`${inputClass} min-h-16`}
                    value={card.description}
                    placeholder="Mô tả"
                    onChange={(event) =>
                      setHighlightCard(index, { description: event.target.value })
                    }
                  />
                  {[0, 1, 2].map((imageIndex) => (
                    <ImageField
                      key={imageIndex}
                      label={`Ảnh ${imageIndex + 1}${imageIndex < 2 ? " (cột trái)" : " (cột phải)"}`}
                      image={card.images[imageIndex] ?? { url: "", alt: "" }}
                      media={media}
                      onUpload={handleUpload}
                      onChange={(image) =>
                        setHighlightCard(index, {
                          images: card.images.map((item, itemIndex) =>
                            itemIndex === imageIndex ? image : item,
                          ),
                        })
                      }
                    />
                  ))}
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className={inputClass}
                      value={card.ctaLabel}
                      placeholder="Nhãn nút"
                      onChange={(event) => setHighlightCard(index, { ctaLabel: event.target.value })}
                    />
                    <input
                      className={inputClass}
                      value={card.ctaHref || ""}
                      placeholder="URL nút (tùy chọn)"
                      onChange={(event) => setHighlightCard(index, { ctaHref: event.target.value })}
                    />
                  </div>
                </div>
              </details>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Nhãn CTA cuối trang">
                <input
                  className={inputClass}
                  value={content.highlights.ctaLabel}
                  onChange={(event) => updateHighlights({ ctaLabel: event.target.value })}
                />
              </Field>
              <Field label="URL CTA cuối trang" hint="Để trống sẽ mở form đăng ký.">
                <input
                  className={inputClass}
                  value={content.highlights.ctaHref || ""}
                  onChange={(event) => updateHighlights({ ctaHref: event.target.value })}
                />
              </Field>
            </div>
          </Section>

          <Section title="Đăng ký & Liên hệ">
            <div className="rounded-sm border border-line bg-cyan-bg/50 p-2 text-xs text-brand-teal">
              <p className="font-semibold">Form đăng ký đang gắn</p>
              <p className="mt-1 font-mono text-[11px] text-muted">
                {linkedForm ? linkedForm.token : "Chưa gắn form"}
              </p>
              <p className="mt-1 text-[11px] text-muted">
                Thay đổi form tại trang Workshop (nút &quot;Tạo Landing Page&quot;).
              </p>
            </div>
            <Field label="Đơn vị tổ chức">
              <input
                className={inputClass}
                value={content.highlights.contact.organizer}
                onChange={(event) =>
                  updateHighlights({
                    contact: { ...content.highlights.contact, organizer: event.target.value },
                  })
                }
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Email liên hệ">
                <input
                  className={inputClass}
                  value={content.highlights.contact.email}
                  onChange={(event) =>
                    updateHighlights({
                      contact: { ...content.highlights.contact, email: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Số điện thoại">
                <input
                  className={inputClass}
                  value={content.highlights.contact.phone}
                  onChange={(event) =>
                    updateHighlights({
                      contact: { ...content.highlights.contact, phone: event.target.value },
                    })
                  }
                />
              </Field>
            </div>
          </Section>

          <Section title="SEO">
            <Field label="Tiêu đề trang">
              <input
                className={inputClass}
                value={content.seo.title}
                onChange={(event) => updateSeo({ title: event.target.value })}
              />
            </Field>
            <Field label="Meta description">
              <textarea
                className={`${inputClass} min-h-16`}
                value={content.seo.description}
                onChange={(event) => updateSeo({ description: event.target.value })}
              />
            </Field>
            <Field label="Đường dẫn công khai">
              <span className="block rounded-sm border border-line bg-cyan-bg/50 px-2.5 py-2 font-mono text-xs text-muted">
                /workshops/{workshop.slug}
              </span>
            </Field>
          </Section>
        </div>

        <div className={`${mobileTab === "preview" ? "block" : "hidden"} lg:block`}>
          <div className="rounded-md border border-line bg-surface p-2 lg:sticky lg:top-[72px]">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
              <div className="flex gap-1 rounded-sm border border-line p-0.5">
                {VIEWPORTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setViewport(item.id)}
                    aria-pressed={viewport === item.id}
                    className={`min-h-8 rounded-sm px-2.5 text-xs font-semibold ${
                      viewport === item.id ? "bg-brand text-brand-teal" : "text-muted"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={pushToPreview}
                className="min-h-8 rounded-sm border border-line px-2.5 text-xs font-semibold text-brand-teal"
              >
                Làm mới
              </button>
            </div>
            <div className="flex justify-center rounded-sm bg-surface-muted p-2">
              <div
                className="overflow-hidden rounded-md border border-line bg-white transition-all"
                style={{
                  width: activeViewport.width ? `${activeViewport.width}px` : "100%",
                  maxWidth: "100%",
                }}
              >
                <iframe
                  ref={iframeRef}
                  src={`/landing-preview/${workshopId}`}
                  onLoad={pushToPreview}
                  title="Xem trước landing page"
                  className="h-[75vh] w-full border-0"
                />
              </div>
            </div>
            <p className="pt-1.5 text-center text-[11px] text-muted">
              Cuộn trong khung để xem hiệu ứng. Preview cập nhật theo nội dung đang sửa.
            </p>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-brand-teal px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
