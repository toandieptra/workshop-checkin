/**
 * In-memory rate limiter.
 *
 * CẢNH BÁO: Chỉ phù hợp khi chạy 1 instance Next.js (Node). Nếu chạy nhiều
 * instance hoặc serverless (Vercel, Cloud Run auto-scale), cần thay bằng
 * Redis/Upstash. Đã chấp nhận giới hạn này theo yêu cầu.
 */

type Bucket = { count: number; until: number };

// Module-level: sống trong suốt vòng đời worker process.
const buckets = new Map<string, Bucket>();

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterMs: number };

export function checkAndIncrement(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  // Prune entry cũ.
  const existing = buckets.get(key);
  if (existing && existing.until <= now) {
    buckets.delete(key);
  }
  const cur = buckets.get(key);
  if (!cur) {
    buckets.set(key, { count: 1, until: now + opts.windowMs });
    return { ok: true, remaining: opts.limit - 1 };
  }
  if (cur.count >= opts.limit) {
    return { ok: false, retryAfterMs: Math.max(0, cur.until - now) };
  }
  cur.count += 1;
  return { ok: true, remaining: opts.limit - cur.count };
}

/**
 * Reset bucket — dùng sau khi login thành công để tránh user vừa đúng pass
 * vẫn bị khóa vì các lần thử sai trước đó.
 */
export function reset(key: string): void {
  buckets.delete(key);
}