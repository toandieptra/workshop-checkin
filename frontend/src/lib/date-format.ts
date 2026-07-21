const WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timePart(value?: string | null): string {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

export function formatEventDate(dateValue?: string | null): string {
  const date = parseDate(dateValue);
  if (!date) return dateValue || "—";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

export function formatEventDateTime(dateValue?: string | null, timeValue?: string | null, full = false): string {
  const date = parseDate(dateValue);
  if (!date) return dateValue || "—";
  const datePart = formatEventDate(dateValue);
  const time = timePart(timeValue);
  const day = full ? `${WEEKDAYS[date.getDay()]}, ` : "";
  return `${time ? `${time} · ` : ""}${day}${datePart}`;
}

export function formatTimestamp(value?: string | null): string {
  const date = parseDate(value);
  if (!date) return "—";
  return date.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function shortLocation(value?: string | null): string {
  if (!value) return "";
  return value.split(",").slice(0, 2).join(",").trim();
}
