import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function normalizeRecipient(result, phone) {
  const phoneResult = result && typeof result === "object" ? result[phone] : null;
  const candidates = Array.isArray(result)
    ? result
    : result?.uid || result?.userId || result?.user_id
      ? result
      : result?.users || result?.data || phoneResult || (result && typeof result === "object" ? Object.values(result) : result);
  const first = Array.isArray(candidates) ? candidates.find((item) => item && typeof item === "object") || {} : candidates || {};
  const userId = String(first.uid || first.userId || first.user_id || first.id || "");
  const threadId = String(first.threadId || first.thread_id || userId);
  const recipientName = first.displayName || first.display_name || first.zaloName || first.zalo_name || null;
  return {
    user_id: userId || null,
    thread_id: threadId || null,
    thread_type: 0,
    recipient_name: recipientName,
    display_name: recipientName,
  };
}

export function extractMessageId(result) {
  if (!result || typeof result !== "object") return null;
  return result.message_id || result.msg_id || result.msgId || result.message?.msgId || result.message?.message_id || null;
}

export function createRequestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function safeUploadPath(input, uploadRoot) {
  if (typeof input !== "string" || !input || input.length > 4096 || !isAbsolute(input)) {
    throw createRequestError("Đường dẫn ảnh không hợp lệ");
  }
  let path;
  let root;
  try {
    [path, root] = await Promise.all([realpath(input), realpath(resolve(uploadRoot))]);
  } catch {
    throw createRequestError("Đường dẫn ảnh không tồn tại");
  }
  const relativePath = relative(root, path);
  const escaped = relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
  if (escaped || !(await stat(path)).isFile()) {
    throw createRequestError("Đường dẫn ảnh nằm ngoài thư mục upload hoặc không phải file");
  }
  return path;
}
