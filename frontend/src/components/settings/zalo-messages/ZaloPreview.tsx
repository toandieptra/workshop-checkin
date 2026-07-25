"use client";

import { PlayIcon } from "@heroicons/react/24/solid";
import type { ZaloMessageBlock, ZaloMessageTemplateInput } from "@/types/zalo-message";
import AlbumGrid from "./AlbumGrid";

export default function ZaloPreview({
  template,
}: {
  template: Pick<ZaloMessageTemplateInput, "name" | "blocks">;
}) {
  return (
    <div className="mx-auto w-full max-w-[340px] rounded-[28px] border-[7px] border-[#173b42] bg-[#e9f5f7] p-3 shadow-lg">
      <div className="mb-3 flex items-center gap-2 border-b border-white/80 pb-3">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-[#0068ff] text-sm font-bold text-white">
          Z
        </div>
        <div>
          <div className="text-sm font-bold text-ink">Workshop Check-in</div>
          <div className="text-[11px] text-muted">Tin nhắn Zalo</div>
        </div>
      </div>
      <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
        {!template.blocks.length && (
          <div className="rounded-xl bg-white p-4 text-center text-xs text-muted">
            Thêm block để xem trước tin nhắn.
          </div>
        )}
        {template.blocks.map((block) => (
          <div
            key={block.id || `${block.type}-${block.text || block.url || ""}`}
            className="overflow-hidden rounded-xl rounded-tl-sm bg-white shadow-sm"
          >
            {block.type === "text" && (
              <div className="whitespace-pre-wrap break-words px-3 py-2.5 text-sm text-ink">
                {block.text || "Nội dung văn bản..."}
              </div>
            )}
            {block.type === "image" && (
              <AlbumGrid block={block as ZaloMessageBlock} />
            )}
            {block.type === "video" && (
              <div className="relative grid min-h-36 place-items-center bg-[#173b42]">
                {block.thumbnail_url ? (
                  <img
                    src={block.thumbnail_url}
                    alt="Thumbnail video"
                    className="absolute inset-0 h-full w-full object-cover opacity-80"
                  />
                ) : null}
                <span className="relative grid h-12 w-12 place-items-center rounded-full bg-white/90 text-brand-teal">
                  <PlayIcon className="h-6 w-6 translate-x-0.5" aria-hidden />
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mx-auto mt-4 h-1 w-24 rounded-full bg-[#173b42]/30" />
    </div>
  );
}
