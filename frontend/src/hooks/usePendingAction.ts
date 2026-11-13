"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { beginRequest, currentInteractionSources } from "@/lib/pending-actions";

/**
 * Quản lý `isPending` tường minh cho một thao tác bất đồng bộ + chống gọi trùng ở tầng handler.
 *
 *   const save = usePendingAction(async () => { await api(...); });
 *   <button onClick={save.run} disabled={save.isPending}>Lưu</button>
 *
 * - Khoá đồng bộ bằng ref: lần gọi thứ hai khi lần trước chưa xong sẽ bị bỏ qua (trả về undefined),
 *   kể cả trước khi React kịp re-render `disabled`.
 * - Phần tử vừa được bấm được khoá + spinner trong SUỐT thời gian `fn` chạy (kể cả các await không phải request).
 * - Luôn khôi phục trạng thái trong `finally`, dù thành công hay lỗi (lỗi vẫn được ném lại cho caller).
 */
export function usePendingAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [isPending, setPending] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (lock.current) return undefined;
    lock.current = true;
    setPending(true);
    const end = beginRequest({ global: true, sources: currentInteractionSources() });
    try {
      return await fnRef.current(...args);
    } finally {
      lock.current = false;
      end();
      if (mounted.current) setPending(false);
    }
  }, []);

  return { isPending, run };
}
