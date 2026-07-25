"use client";

import { useCallback, useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import type {
  ZaloMessageBlock,
  ZaloMessageTemplate,
  ZaloMessageTemplateInput,
  ZaloMessageTemplateStatus,
} from "@/types/zalo-message";
import BlockEditor from "./BlockEditor";
import ZaloPreview from "./ZaloPreview";
import { MAX_MEDIA_COUNT } from "./constants";
import { useModalDismiss } from "./useModalDismiss";
import { albumImages, blockId, emptyBlock, mediaCount } from "./utils";

export default function TemplateEditor({
  template,
  saving,
  readOnly,
  onClose,
  onSave,
}: {
  template: ZaloMessageTemplate | null;
  saving: boolean;
  readOnly: boolean;
  onClose: () => void;
  onSave: (input: ZaloMessageTemplateInput) => void;
}) {
  const handleClose = useCallback(() => {
    if (saving) return;
    onClose();
  }, [onClose, saving]);
  useModalDismiss(handleClose);

  const [draft, setDraft] = useState<ZaloMessageTemplateInput>(() =>
    template
      ? {
          name: template.name,
          description: template.description || "",
          status: template.status,
          auto_send_new_guest: template.auto_send_new_guest,
          auto_send_checkin: template.auto_send_checkin,
          blocks: template.blocks.map((block) => ({
            ...block,
            id: block.id || blockId(),
          })),
        }
      : {
          name: "",
          description: "",
          status: "draft",
          auto_send_new_guest: false,
          auto_send_checkin: false,
          blocks: [emptyBlock("text")],
        },
  );

  const valid =
    draft.name.trim() &&
    draft.blocks.length &&
    mediaCount(draft.blocks as ZaloMessageBlock[]) <= MAX_MEDIA_COUNT &&
    draft.blocks.every((block) =>
      block.type === "text"
        ? block.text?.trim()
        : block.type === "video"
          ? block.url?.trim() && block.thumbnail_url?.trim()
          : albumImages(block as ZaloMessageBlock).some((image) =>
              image.url.trim(),
            ),
    );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={template ? "Sửa mẫu tin" : "Tạo mẫu tin"}
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden bg-[#f8fbfb] shadow-xl sm:h-[calc(100vh-2rem)] sm:rounded-xl">
        <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3 sm:px-6">
          <div>
            <h2 className="font-heading text-lg font-bold text-ink">
              {readOnly
                ? "Xem mẫu tin Zalo"
                : template
                  ? "Sửa mẫu tin Zalo"
                  : "Tạo mẫu tin Zalo"}
            </h2>
            <p className="text-xs text-muted">
              Thiết kế nội dung theo từng block và xem trước ngay lập tức.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="grid h-10 w-10 place-items-center rounded-full text-muted transition hover:bg-surface-muted"
            aria-label="Đóng"
          >
            <XMarkIcon className="h-6 w-6" aria-hidden />
          </button>
        </header>
        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_390px] lg:overflow-hidden">
          <fieldset
            disabled={readOnly}
            className="space-y-5 p-4 disabled:opacity-80 lg:overflow-y-auto lg:p-6"
          >
            <div className="grid gap-4 sm:grid-cols-[1fr_190px]">
              <label className="block text-sm font-semibold text-text-secondary">
                Tên mẫu tin *
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  className="mt-1 min-h-10 w-full rounded-md border border-line px-3 font-normal outline-none focus:border-brand"
                />
              </label>
              <label className="block text-sm font-semibold text-text-secondary">
                Trạng thái
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      status: event.target.value as ZaloMessageTemplateStatus,
                    })
                  }
                  className="mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 font-normal outline-none focus:border-brand"
                >
                  <option value="draft">Bản nháp</option>
                  <option value="active">Đang sử dụng</option>
                  <option value="archived">Đã lưu trữ</option>
                </select>
              </label>
            </div>
            <label className="block text-sm font-semibold text-text-secondary">
              Mô tả
              <input
                value={draft.description || ""}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                className="mt-1 min-h-10 w-full rounded-md border border-line px-3 font-normal outline-none focus:border-brand"
              />
            </label>
            <section>
              <div className="mb-3">
                <h3 className="font-heading font-bold text-ink">
                  Nội dung tin nhắn
                </h3>
                <p className="text-xs text-muted">
                  Kéo thả hoặc dùng nút lên/xuống để đổi thứ tự block. Giới hạn:
                  50MB/file, 10 media/template, 2000 ký tự/text.
                </p>
              </div>
              <BlockEditor
                blocks={draft.blocks as ZaloMessageBlock[]}
                onChange={(blocks) => setDraft({ ...draft, blocks })}
              />
            </section>
          </fieldset>
          <aside className="border-t border-line bg-[#eaf4f5] p-5 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <div className="mb-4 text-center text-xs font-bold uppercase tracking-[0.14em] text-brand-teal">
              Xem trước trên Zalo
            </div>
            <ZaloPreview template={draft} />
          </aside>
        </div>
        <footer className="flex justify-end gap-2 border-t border-line bg-white px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-10 rounded-md border border-line px-4 text-sm font-semibold transition hover:bg-surface-muted"
          >
            {readOnly ? "Đóng" : "Hủy"}
          </button>
          {!readOnly && (
            <button
              type="button"
              disabled={!valid || saving}
              onClick={() =>
                onSave({
                  ...draft,
                  name: draft.name.trim(),
                  description: draft.description?.trim(),
                })
              }
              className="min-h-10 rounded-md bg-brand px-5 text-sm font-semibold text-brand-teal transition hover:bg-brand-accent disabled:opacity-40"
            >
              {saving ? "Đang lưu..." : "Lưu mẫu tin"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
