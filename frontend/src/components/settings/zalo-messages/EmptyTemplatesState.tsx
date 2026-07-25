"use client";

import { ChatBubbleLeftRightIcon, PlusIcon } from "@heroicons/react/24/outline";

export default function EmptyTemplatesState({
  canCreate,
  onCreate,
}: {
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="px-4 py-14 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand/10 text-brand-teal">
        <ChatBubbleLeftRightIcon className="h-7 w-7" aria-hidden />
      </div>
      <div className="mt-4 font-semibold text-ink">Chưa có mẫu tin phù hợp</div>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        Hãy đổi bộ lọc hoặc tạo mẫu tin đầu tiên để gửi Zalo cho khách tham dự.
      </p>
      {canCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-brand-teal transition hover:bg-brand-accent"
        >
          <PlusIcon className="h-4 w-4" aria-hidden />
          Tạo mẫu tin
        </button>
      )}
    </div>
  );
}
