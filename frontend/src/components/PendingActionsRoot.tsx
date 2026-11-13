"use client";

import { useEffect } from "react";
import { installPendingActions } from "@/lib/pending-actions";

/** Bật cơ chế loading state + chống thao tác trùng cho toàn bộ ứng dụng (xem lib/pending-actions.ts). */
export default function PendingActionsRoot() {
  useEffect(() => { installPendingActions(); }, []);
  return null;
}
