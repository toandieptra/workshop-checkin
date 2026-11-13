/**
 * Cơ chế chung: Loading State & Duplicate Action Prevention cho mọi trang (desktop + mobile).
 *
 * Mỗi request đi qua `beginRequest()` (api/adminApi/apiForm/survey/... đã gọi sẵn) sẽ:
 *  1. Bật con trỏ `progress` toàn trang (`html[data-app-busy]`), con trỏ `wait` trên phần tử đang xử lý.
 *  2. Gắn request vào phần tử người dùng vừa thao tác (nút, form, select, checkbox, tab...) và khoá nó:
 *     `data-action-pending` + `aria-busy`. Bộ lắng nghe ở pha capture của `window` chặn click / submit /
 *     Enter / Space lên phần tử đang khoá TRƯỚC khi tới handler React — không chỉ dựa vào con trỏ.
 *  3. Hiện spinner trên nút (CSS, không chèn DOM vào cây React).
 *  4. Tự khôi phục khi request kết thúc (thành công hay lỗi). Nếu handler gọi tiếp request kế tiếp ngay
 *     sau khi request trước xong (`await save(); await reload()`), nút vẫn giữ khoá tới khi chuỗi xong.
 *
 * Cách gắn request ↔ thao tác:
 *  - "immediate": request bắt đầu trong cùng task với sự kiện click/submit/change (gồm microtask và
 *    effect React flush đồng bộ sau sự kiện rời rạc).
 *  - "linger": request bắt đầu ngay khi request trước của cùng phần tử vừa kết thúc (chuỗi await).
 *  - "late": request ghi (POST/PUT/PATCH/DELETE) bắt đầu trong ≤1,5s sau thao tác, chưa có thao tác khác.
 *  Request nền (polling, autosave) truyền `background: true` để không gắn và không đổi con trỏ.
 *
 * Với luồng đặc biệt, dùng `usePendingAction()` (React) hoặc `runPendingAction()` để quản lý
 * `isPending` tường minh và khoá cứng trong suốt thời gian chạy.
 */

type End = () => void;
type Variant = "overlay" | "inline" | "self" | "dim" | "form";

interface ElementState {
  count: number;
  restoreTimer: ReturnType<typeof setTimeout> | null;
  frame: number | null;
  ownAriaBusy: boolean;
}

export interface BeginRequestOptions {
  /** Bật con trỏ chờ toàn trang kể cả khi không gắn được vào phần tử nào (tải dữ liệu trang). */
  global?: boolean;
  /** Request nền: không khoá phần tử, không đổi con trỏ. */
  background?: boolean;
  /** HTTP method — dùng cho quy tắc gắn muộn ("late") chỉ áp dụng với request ghi. */
  method?: string;
  /** Gắn tường minh vào các phần tử này thay vì tự suy ra. */
  sources?: Element[] | null;
}

const SOURCE_SELECTOR = [
  "[data-pending-scope]",
  "button",
  'input[type="submit"]',
  'input[type="button"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  "select",
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="option"]',
  "a:not([href])",
].join(",");
const IGNORE_SELECTOR = "[data-pending-ignore]";
const LATE_WINDOW_MS = 1500;
const MUTATION = /^(POST|PUT|PATCH|DELETE)$/i;

const elementStates = new Map<Element, ElementState>();
let immediateSources: Element[] = [];
let immediateTimer: ReturnType<typeof setTimeout> | null = null;
const lingerSources = new Set<Element>();
let armed: { sources: Element[]; at: number } | null = null;
/** input[type=file] → nút/label đã mở hộp chọn file, để khoá đúng nút khi upload. */
const fileTriggers = new WeakMap<HTMLInputElement, Element[]>();
let globalCount = 0;
const globalListeners = new Set<(pending: boolean) => void>();
let installed = false;

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

// ---------------------------------------------------------------- global busy state

function setGlobal(delta: number) {
  const before = globalCount > 0;
  globalCount = Math.max(0, globalCount + delta);
  const after = globalCount > 0;
  if (before === after) return;
  document.documentElement.toggleAttribute("data-app-busy", after);
  globalListeners.forEach((listener) => listener(after));
}

export function isGlobalPending(): boolean {
  return globalCount > 0;
}

export function subscribeGlobalPending(listener: (pending: boolean) => void): () => void {
  globalListeners.add(listener);
  return () => { globalListeners.delete(listener); };
}

/** Con trỏ chờ toàn trang cho tác vụ không phải request (điều hướng, chuyển trang...). */
export function beginGlobalPending(): End {
  if (!isBrowser()) return () => {};
  setGlobal(1);
  return once(() => setGlobal(-1));
}

// ---------------------------------------------------------------- element lock

function once(fn: () => void): End {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}

function isButtonLike(el: Element): boolean {
  return el.matches('button, label, [role="button"], [role="tab"], [role="menuitem"], a:not([href]), [data-pending-scope]:not(form)');
}

function decideVariant(el: Element): Variant {
  if (el.tagName === "FORM") return "form";
  if (!(el instanceof HTMLElement) || !isButtonLike(el)) return "dim";
  if (el.querySelector(".animate-spin, [data-loading-indicator]")) return "self";
  if (!el.matches("button, a")) {
    const rect = el.getBoundingClientRect();
    // Vùng lớn (thẻ, dòng bấm được dạng role=button): không che nội dung, chỉ làm mờ + khoá.
    if (rect.width > 360 || rect.height > 96) return "dim";
  }
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return "inline";
  return "overlay";
}

function applyVariant(el: Element) {
  const state = elementStates.get(el);
  if (!state || !(el instanceof HTMLElement)) return;
  state.frame = null;
  const variant = decideVariant(el);
  if (variant === "overlay" || variant === "inline") {
    const style = getComputedStyle(el);
    el.style.setProperty("--ap-color", style.color);
    if (variant === "overlay" && style.position === "static") el.setAttribute("data-action-pending-rel", "");
  }
  el.setAttribute("data-action-pending", variant);
}

function attach(el: Element) {
  const existing = elementStates.get(el);
  if (existing) {
    existing.count += 1;
    if (existing.restoreTimer) clearTimeout(existing.restoreTimer);
    existing.restoreTimer = null;
    lingerSources.delete(el);
    return;
  }
  const state: ElementState = { count: 1, restoreTimer: null, frame: null, ownAriaBusy: false };
  elementStates.set(el, state);
  // Khoá ngay lập tức (đồng bộ) — chọn kiểu hiển thị ở frame sau, khi React đã commit
  // (biết được nút có tự `disabled` / tự có spinner hay không).
  el.setAttribute("data-action-pending", "");
  if (!el.hasAttribute("aria-busy")) {
    el.setAttribute("aria-busy", "true");
    state.ownAriaBusy = true;
  }
  state.frame = requestAnimationFrame(() => applyVariant(el));
}

function restore(el: Element) {
  const state = elementStates.get(el);
  if (!state) return;
  elementStates.delete(el);
  lingerSources.delete(el);
  if (state.frame !== null) cancelAnimationFrame(state.frame);
  el.removeAttribute("data-action-pending");
  el.removeAttribute("data-action-pending-rel");
  if (state.ownAriaBusy) el.removeAttribute("aria-busy");
  if (el instanceof HTMLElement) el.style.removeProperty("--ap-color");
}

function detach(el: Element) {
  const state = elementStates.get(el);
  if (!state) return;
  state.count -= 1;
  if (state.count > 0) return;
  // Giữ khoá thêm một task: nếu handler gọi tiếp request khác (chuỗi await), request đó
  // gắn lại vào phần tử này và nút không bị "nhả" giữa chừng.
  lingerSources.add(el);
  state.restoreTimer = setTimeout(() => restore(el), 0);
}

export function isElementPending(el: Element | null | undefined): boolean {
  return Boolean(el && elementStates.has(el));
}

function pendingAncestor(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const pending = target.closest("[data-action-pending]");
  return pending && elementStates.has(pending) ? pending : null;
}

// ---------------------------------------------------------------- interaction tracking

function setImmediate(sources: Element[]) {
  immediateSources = sources;
  armed = sources.length ? { sources, at: Date.now() } : null;
  if (immediateTimer) clearTimeout(immediateTimer);
  immediateTimer = setTimeout(() => {
    immediateSources = [];
    immediateTimer = null;
  }, 0);
}

function sourceFor(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  if (target.closest(IGNORE_SELECTOR)) return null;
  const el = target.closest(SOURCE_SELECTOR);
  if (!el) return null;
  // Liên kết điều hướng (a[href]) không bị khoá ở đây — điều hướng admin đã có cơ chế riêng.
  return el;
}

function block(event: Event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function onClick(event: MouseEvent) {
  if (pendingAncestor(event.target)) return block(event);
  if (event.target instanceof HTMLInputElement && event.target.type === "file") {
    // Hộp chọn file mở từ nút (fileRef.current.click()) hoặc label bọc input.
    const input = event.target;
    const label = input.closest("label") ?? (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null);
    const triggers = [...immediateSources.filter((el) => el !== input), ...(label ? [label] : [])];
    fileTriggers.set(input, triggers.length ? triggers : [input]);
    return;
  }
  const source = sourceFor(event.target);
  if (!source) {
    // Click ra vùng khác: huỷ quy tắc gắn muộn để không gắn nhầm.
    armed = null;
    return;
  }
  const form = source.matches('button:not([type="button"]):not([type="reset"]), input[type="submit"]') ? (source as HTMLButtonElement).form : null;
  if (form && elementStates.has(form)) return block(event);
  setImmediate([source]);
}

function onSubmit(event: SubmitEvent) {
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  if (!form) return;
  if (elementStates.has(form) || pendingAncestor(form)) return block(event);
  const submitter = (event.submitter as Element | null)
    ?? form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
  if (submitter && elementStates.has(submitter)) return block(event);
  if (form.closest(IGNORE_SELECTOR)) return;
  setImmediate(submitter ? [submitter, form] : [form]);
}

function onChange(event: Event) {
  if (event.target instanceof HTMLInputElement && event.target.type === "file") {
    const triggers = (fileTriggers.get(event.target) ?? []).filter((el) => el.isConnected);
    setImmediate(triggers.length ? triggers : [event.target]);
    return;
  }
  const source = sourceFor(event.target);
  if (!source || !source.matches("select, input, [data-pending-scope]")) return;
  setImmediate([source]);
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const pending = pendingAncestor(event.target);
  if (!pending) return;
  // Đang gõ trong ô nhập của form bị khoá: chỉ chặn Enter (gửi lại), vẫn cho gõ dấu cách.
  if (event.key === " " && event.target instanceof HTMLElement && event.target.matches("input, textarea, [contenteditable]")) return;
  block(event);
}

/** Gắn bộ lắng nghe toàn cục (idempotent). Gọi một lần ở root layout; `beginRequest` cũng tự gọi. */
export function installPendingActions() {
  if (installed || !isBrowser()) return;
  installed = true;
  window.addEventListener("click", onClick, true);
  window.addEventListener("dblclick", (event) => { if (pendingAncestor(event.target)) block(event); }, true);
  window.addEventListener("submit", onSubmit, true);
  window.addEventListener("change", onChange, true);
  window.addEventListener("keydown", onKeyDown, true);
}

/** Phần tử người dùng vừa thao tác (dùng cho `usePendingAction`). */
export function currentInteractionSources(): Element[] {
  return immediateSources.filter((el) => el.isConnected);
}

function resolveSources(options: BeginRequestOptions): Element[] {
  if (options.sources) return options.sources.filter(Boolean);
  const set = new Set<Element>();
  immediateSources.forEach((el) => set.add(el));
  lingerSources.forEach((el) => set.add(el));
  if (!set.size && armed && options.method && MUTATION.test(options.method) && Date.now() - armed.at <= LATE_WINDOW_MS) {
    armed.sources.forEach((el) => set.add(el));
    armed = null;
  }
  return Array.from(set).filter((el) => el.isConnected);
}

/**
 * Bắt đầu theo dõi một tác vụ bất đồng bộ. Trả về hàm kết thúc (gọi trong `finally`, gọi nhiều lần vô hại).
 */
export function beginRequest(options: BeginRequestOptions = {}): End {
  if (!isBrowser() || options.background) return () => {};
  installPendingActions();
  const sources = resolveSources(options);
  const counted = Boolean(options.global) || sources.length > 0;
  if (counted) setGlobal(1);
  sources.forEach(attach);
  return once(() => {
    sources.forEach(detach);
    if (counted) setGlobal(-1);
  });
}

/** Chạy `fn` với phần tử `el` bị khoá + spinner trong suốt thời gian chạy. */
export async function runPendingAction<T>(el: Element | Element[] | null | undefined, fn: () => Promise<T>): Promise<T> {
  const sources = (Array.isArray(el) ? el : el ? [el] : []).filter(Boolean);
  const end = beginRequest({ global: true, sources });
  try {
    return await fn();
  } finally {
    end();
  }
}

// ---------------------------------------------------------------- request de-duplication

const inflight = new Map<string, Promise<unknown>>();

/**
 * Gộp các request ghi giống hệt nhau (cùng method + URL + body) đang chạy thành một — lớp chống gửi
 * trùng thứ hai ngoài khoá sự kiện (Enter lặp, hai nút cùng gửi một yêu cầu, gọi lại từ code...).
 */
export function dedupeRequest<T>(method: string, url: string, init: RequestInit | undefined, run: () => Promise<T>): Promise<T> {
  const body = init?.body;
  if (!MUTATION.test(method) || init?.signal || init?.keepalive || (body != null && typeof body !== "string")) return run();
  const key = `${method.toUpperCase()} ${url} ${body ?? ""}`;
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = run().finally(() => { inflight.delete(key); });
  inflight.set(key, promise);
  return promise;
}

/** `fetch` có theo dõi loading — dùng thay cho `fetch` gọi thẳng trong UI. */
export async function trackedFetch(input: string, init?: RequestInit & { background?: boolean; global?: boolean }): Promise<Response> {
  const { background, global = true, ...fetchInit } = init ?? {};
  const end = beginRequest({ global, background, method: fetchInit.method ?? "GET" });
  try {
    return await fetch(input, fetchInit);
  } finally {
    end();
  }
}
