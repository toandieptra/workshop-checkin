import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createRequestError, extractMessageId, normalizeRecipient, safeUploadPath } from "./helpers.js";

const host = process.env.ZALO_BRIDGE_HOST || "0.0.0.0";
const port = Number(process.env.ZALO_BRIDGE_PORT || 18928);
const token = process.env.ZALO_BRIDGE_TOKEN || "";
const mcpHost = process.env.ZALO_MCP_HOST || "0.0.0.0";
const mcpPort = Number(process.env.ZALO_MCP_PORT || 18929);
const mcpToken = process.env.ZALO_MCP_TOKEN || "";
const executable = process.env.ZALO_AGENT_EXECUTABLE || "zalo-agent";
const version = process.env.ZALO_AGENT_VERSION || "1.6.2";
const uploadRoot = resolve(process.env.ZALO_UPLOAD_DIR || process.env.UPLOAD_DIR || "/uploads");
const maxBodyBytes = Number(process.env.ZALO_BRIDGE_MAX_BODY_BYTES || 64 * 1024);
const sessions = new Map();
const rateLimits = new Map();

let loginProcess = null;
let mcpProcess = null;
let mcpHealthy = false;
let mcpStartedAt = null;
let lastError = null;
let intentionalStop = false;
let restartTimer = null;
let operation = Promise.resolve();

if (!token) throw new Error("ZALO_BRIDGE_TOKEN is required");
if (!mcpToken) throw new Error("ZALO_MCP_TOKEN is required");

function authorized(request) {
  const received = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
  const expectedBuffer = Buffer.from(token);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function send(response, status, responseBody) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(responseBody));
}

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBodyBytes) throw requestError("Request body is too large", 413);
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw requestError("Request body phải là JSON hợp lệ"); }
}

function parseLastJson(stdout) {
  try { return JSON.parse(stdout.trim()); } catch {}
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  return [...lines].reverse().map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).find((value) => value !== null) ?? {};
}

function run(args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--json", ...args], {
      env: { ...process.env, ZALO_JSON_MODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`zalo-agent timed out: ${args[0]}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || stdout.trim() || `zalo-agent exited with code ${code}`));
      const plainStdout = stdout.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (plainStdout.includes("✗ ")) return reject(new Error(plainStdout));
      resolve(parseLastJson(stdout));
    });
  });
}

function maskPhone(phone) {
  return phone.length > 4 ? `${phone.slice(0, 3)}***${phone.slice(-2)}` : "***";
}

async function resolveRecipient(phone) {
  let found = normalizeRecipient(await run(["friend", "find-phones", phone]), phone);
  if (!found.user_id) found = normalizeRecipient(await run(["friend", "find", phone]), phone);
  return found;
}

function safeAccount(account) {
  if (!account) return null;
  return {
    ownId: String(account.ownId || ""),
    name: String(account.name || ""),
    proxy: account.proxy || null,
    active: Boolean(account.active),
  };
}

async function accounts() {
  const result = await run(["account", "list"]);
  return Array.isArray(result) ? result.map(safeAccount) : [];
}

async function activeAccount() {
  return (await accounts()).find((account) => account.active) || null;
}

function mcpHealth() {
  return new Promise((resolve) => {
    const request = import("node:http").then(({ get }) => {
      const healthRequest = get(`http://127.0.0.1:${mcpPort}/health`, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      healthRequest.setTimeout(1500, () => { healthRequest.destroy(); resolve(false); });
      healthRequest.on("error", () => resolve(false));
    });
    request.catch(() => resolve(false));
  });
}

async function waitForMcp(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!mcpProcess) return false;
    if (await mcpHealth()) {
      mcpHealthy = true;
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  mcpHealthy = false;
  return false;
}

function scheduleRestart() {
  if (intentionalStop || restartTimer || loginProcess) return;
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    if ((await accounts()).length) startMcp();
  }, 5000);
}

function startMcp() {
  if (mcpProcess || loginProcess) return;
  intentionalStop = false;
  lastError = null;
  const child = spawn(executable, [
    "mcp", "start",
    "--http", String(mcpPort),
    "--host", mcpHost,
    "--auth", mcpToken,
  ], { env: process.env, stdio: ["ignore", "ignore", "pipe"] });
  mcpProcess = child;
  mcpHealthy = false;
  mcpStartedAt = new Date().toISOString();
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr = (stderr + text).slice(-8000);
    if (text.includes("Duplicate Zalo Web session")) lastError = "Phát hiện phiên Zalo Web trùng lặp (code 3000)";
  });
  child.on("error", (error) => { lastError = error.message; });
  child.on("close", (code) => {
    mcpProcess = null;
    mcpHealthy = false;
    if (!intentionalStop) {
      lastError ||= stderr.trim() || `MCP process exited with code ${code}`;
      if (!lastError.includes("code 3000")) scheduleRestart();
    }
  });
  void waitForMcp();
}

async function stopMcp() {
  intentionalStop = true;
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  const child = mcpProcess;
  if (!child) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
    child.once("close", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
  mcpProcess = null;
  mcpHealthy = false;
}

async function restartMcp() {
  await stopMcp();
  if (!(await accounts()).length) return false;
  startMcp();
  const healthy = await waitForMcp();
  if (!healthy) throw new Error(lastError || "MCP Zalo không khởi động được");
  return true;
}

async function status() {
  if (mcpProcess) mcpHealthy = await mcpHealth();
  return {
    available: true,
    loggedIn: mcpHealthy,
    ownId: mcpHealthy ? (await activeAccount())?.ownId || null : null,
    activeAccount: await activeAccount(),
    version,
    mcpRunning: Boolean(mcpProcess),
    mcpHealthy,
    mcpStartedAt,
    lastError,
  };
}

function serialize(action) {
  const next = operation.then(action, action);
  operation = next.catch(() => {});
  return next;
}

function validOwnerId(ownerId) {
  return typeof ownerId === "string" && /^[0-9]{5,30}$/.test(ownerId);
}

const requestError = createRequestError;

async function requireActiveAccount(ownerId) {
  if (!validOwnerId(ownerId)) throw requestError("account_owner_id không hợp lệ");
  const account = await activeAccount();
  if (!account || account.ownId !== ownerId) throw requestError("account_owner_id không phải tài khoản Zalo đang hoạt động", 409);
  return account;
}

function rateLimit(accountId, bucket, limit, count = 1) {
  const now = Date.now();
  const key = `${accountId}:${bucket}`;
  const timestamps = (rateLimits.get(key) || []).filter((timestamp) => now - timestamp < 60_000);
  if (timestamps.length + count > limit) {
    const retryAfter = Math.max(1, Math.ceil((60_000 - (now - timestamps[0])) / 1000));
    const error = new Error(`Rate limit exceeded for ${bucket}`);
    error.status = 429;
    error.retryAfter = retryAfter;
    throw error;
  }
  for (let index = 0; index < count; index += 1) timestamps.push(now);
  rateLimits.set(key, timestamps);
}

function stringValue(value, name, maxLength = 4096) {
  if (typeof value !== "string" || !value || value.length > maxLength) throw requestError(`${name} không hợp lệ`);
  return value;
}

function optionalString(value, name, maxLength = 4096) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxLength) throw requestError(`${name} không hợp lệ`);
  return value;
}

function urlValue(value, name) {
  const url = stringValue(value, name, 8192);
  try {
    if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error();
  } catch {
    throw requestError(`${name} phải là URL http(s)`);
  }
  return url;
}

async function runAccountOperation(ownerId, bucket, limit, action, count = 1) {
  if (loginProcess) throw requestError("Không thể thao tác khi phiên đăng nhập Zalo đang chạy", 409);
  await requireActiveAccount(ownerId);
  rateLimit(ownerId, bucket, limit, count);
  await stopMcp();
  let actionError;
  try {
    return await action();
  } catch (error) {
    actionError = error;
    throw error;
  } finally {
    try { await restartMcp(); } catch (error) { if (!actionError) throw error; }
  }
}

function requestId() { return randomUUID(); }

function messageArgs(data) {
  const threadId = stringValue(data.thread_id, "thread_id", 30);
  if (!/^[0-9]{5,30}$/.test(threadId)) throw requestError("thread_id không hợp lệ");
  const threadType = data.thread_type ?? 0;
  if (threadType !== 0 && threadType !== 1) throw requestError("thread_type phải là 0 hoặc 1");
  const type = data.type;
  if (type === "text") return ["msg", "send", "--type", String(threadType), threadId, stringValue(data.text, "text", 10_000)];
  if (type === "video") {
    const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
    const args = ["msg", "send-video", "--type", String(threadType), "--thumb", urlValue(data.thumbnail_url, "thumbnail_url")];
    if (data.caption !== undefined) args.push("--caption", optionalString(data.caption, "caption"));
    for (const [field, flag] of [["duration_ms", "--duration"], ["width", "--width"], ["height", "--height"]]) {
      const value = data[field] ?? metadata[field];
      if (value !== undefined) {
        if (!Number.isInteger(value) || value <= 0) throw requestError(`${field} phải là số nguyên dương`);
        args.push(flag, String(value));
      }
    }
    args.push(threadId, urlValue(data.url, "url"));
    return args;
  }
  if (type !== "image_album") throw requestError("type phải là text, image_album hoặc video");
  return { threadId, threadType };
}

async function startLogin() {
  if (loginProcess) throw new Error("Một phiên đăng nhập Zalo khác đang chạy");
  await stopMcp();
  const sessionId = randomUUID();
  const session = { sessionId, status: "waiting", qrDataUrl: null, account: null, error: null, createdAt: Date.now() };
  sessions.set(sessionId, session);
  const child = spawn(executable, ["--json", "login"], {
    env: { ...process.env, ZALO_JSON_MODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  loginProcess = child;
  let pending = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split("\n");
    pending = lines.pop() || "";
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.event === "qr") session.qrDataUrl = event.dataUrl;
        if (event.event === "login_success") {
          session.status = "connected";
          session.qrDataUrl = null;
          session.account = safeAccount({ ownId: event.ownId, name: event.name, active: true });
        }
        if (event.event === "login_error") { session.status = "error"; session.error = event.message; }
      } catch {}
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => { session.status = "error"; session.error = error.message; loginProcess = null; });
  child.on("close", async (code) => {
    loginProcess = null;
    if (code !== 0 && session.status === "waiting") {
      session.status = "error";
      session.error = stderr.trim() || `zalo-agent exited with code ${code}`;
    }
    if (session.status === "connected") {
      startMcp();
      if (!(await waitForMcp())) {
        session.status = "error";
        session.error = lastError || "Đăng nhập thành công nhưng MCP không khởi động được";
      }
    }
  });
  setTimeout(() => {
    if (session.status === "waiting") {
      session.status = "expired";
      session.error = "Phiên QR đã hết hạn";
      child.kill("SIGTERM");
    }
  }, 120_000);
  setTimeout(() => sessions.delete(sessionId), 10 * 60_000);
  return session;
}

const server = createServer(async (request, response) => {
  let responseRequestId = null;
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "POST" && (url.pathname === "/resolve-recipient" || url.pathname === "/resolve-recipients" || url.pathname === "/messages")) responseRequestId = requestId();
    if (url.pathname === "/health") return send(response, 200, { status: "ok", mcpRunning: Boolean(mcpProcess), mcpHealthy });
    if (!authorized(request)) return send(response, 401, { ...(responseRequestId && { request_id: responseRequestId }), error: "Unauthorized" });

    if (request.method === "GET" && url.pathname === "/status") return send(response, 200, await status());
    if (request.method === "GET" && url.pathname === "/accounts") return send(response, 200, await accounts());
    if (request.method === "POST" && url.pathname === "/login") return send(response, 202, await serialize(startLogin));
    if (request.method === "GET" && url.pathname.startsWith("/login/")) {
      const session = sessions.get(url.pathname.slice(7));
      return session ? send(response, 200, session) : send(response, 404, { error: "Phiên đăng nhập không tồn tại hoặc đã hết hạn" });
    }
    if (request.method === "POST" && url.pathname === "/accounts/switch") {
      const data = await readBody(request);
      if (!/^[0-9]{5,30}$/.test(data.owner_id || "")) return send(response, 400, { error: "owner_id không hợp lệ" });
      const result = await serialize(async () => {
        await stopMcp();
        await run(["account", "switch", data.owner_id], 60_000);
        if ((await activeAccount())?.ownId !== data.owner_id) throw new Error("Không chuyển được tài khoản Zalo đang hoạt động");
        await restartMcp();
        return status();
      });
      return send(response, 200, await result);
    }
    if (request.method === "POST" && url.pathname === "/resolve-recipient") {
      const data = await readBody(request);
      const id = responseRequestId;
      const phone = typeof data.phone === "string" ? data.phone.replace(/[\s.-]/g, "") : "";
      if (!/^\+?[0-9]{8,15}$/.test(phone)) return send(response, 400, { request_id: id, error: "phone không hợp lệ" });
      const result = await serialize(() => runAccountOperation(data.account_owner_id, "friend_lookup", 15, async () => {
        return resolveRecipient(phone);
      }));
      return result.thread_id
        ? send(response, 200, { request_id: id, ...result })
        : send(response, 404, { request_id: id, error: "Không tìm thấy tài khoản Zalo cho số điện thoại" });
    }
    if (request.method === "POST" && url.pathname === "/resolve-recipients") {
      const data = await readBody(request);
      const id = responseRequestId;
      if (!Array.isArray(data.recipients) || data.recipients.length < 1 || data.recipients.length > 1000) {
        throw requestError("recipients phải chứa từ 1 đến 1000 phần tử");
      }
      const startedAt = Date.now();
      const result = await serialize(() => runAccountOperation(data.account_owner_id, "friend_lookup", 15, async () => {
        const recipients = [];
        for (const item of data.recipients) {
          const phone = typeof item.phone === "string" ? item.phone.replace(/[\s.-]/g, "") : "";
          if (!/^\+?[0-9]{8,15}$/.test(phone)) {
            recipients.push({ guest_id: item.guest_id, error: "phone không hợp lệ" });
            continue;
          }
          try {
            rateLimit(data.account_owner_id, "friend_lookup", 15);
            recipients.push({ guest_id: item.guest_id, ...await resolveRecipient(phone) });
          } catch (error) {
            if (error?.status === 429) throw error;
            console.warn(JSON.stringify({ event: "recipient_lookup_failed", request_id: id, guest_id: item.guest_id, phone: maskPhone(phone), error: error.message }));
            recipients.push({ guest_id: item.guest_id, error: error.message });
          }
        }
        return { recipients };
      }, 0));
      console.log(JSON.stringify({ event: "recipients_resolved", request_id: id, count: data.recipients.length, duration_ms: Date.now() - startedAt }));
      return send(response, 200, { request_id: id, ...result });
    }
    if (request.method === "POST" && url.pathname === "/messages") {
      const data = await readBody(request);
      const id = responseRequestId;
      const args = messageArgs(data);
      const result = await serialize(() => runAccountOperation(data.account_owner_id, "message", 20, async () => {
        if (Array.isArray(args)) return run(args, 60_000);
        const inputPaths = data.paths || data.image_paths;
        if (!Array.isArray(inputPaths) || inputPaths.length < 1 || inputPaths.length > 10) throw requestError("paths phải chứa từ 1 đến 10 ảnh");
        const paths = await Promise.all(inputPaths.map((inputPath) => safeUploadPath(inputPath, uploadRoot)));
        const command = ["msg", "send-image", "--type", String(args.threadType)];
        if (data.caption !== undefined) command.push("--caption", optionalString(data.caption, "caption"));
        command.push(args.threadId, ...paths);
        return run(command, 120_000);
      }));
      return send(response, 200, { request_id: id, sent: true, message_id: extractMessageId(result), result });
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/accounts/")) {
      const ownerId = decodeURIComponent(url.pathname.slice(10));
      if (!/^[0-9]{5,30}$/.test(ownerId)) return send(response, 400, { error: "owner_id không hợp lệ" });
      const result = await serialize(async () => {
        await stopMcp();
        await run(["account", "remove", ownerId]);
        if ((await accounts()).some((account) => account.ownId === ownerId)) throw new Error("Không xóa được tài khoản Zalo");
        if ((await accounts()).length) await restartMcp();
        return { removed: true };
      });
      return send(response, 200, result);
    }
    if (request.method === "POST" && url.pathname === "/logout") {
      const data = await readBody(request);
      const result = await serialize(async () => {
        await stopMcp();
        await run(data.purge ? ["logout", "--purge"] : ["logout"]);
        if ((await accounts()).length) await restartMcp();
        return status();
      });
      return send(response, 200, await result);
    }
    if (request.method === "POST" && url.pathname === "/reconnect") {
      const result = await serialize(async () => { await restartMcp(); return status(); });
      return send(response, 200, await result);
    }
    return send(response, 404, { error: "Not found" });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    if (error?.retryAfter) response.setHeader("retry-after", String(error.retryAfter));
    console.error(JSON.stringify({ event: "bridge_request_failed", request_id: responseRequestId, status, error: error instanceof Error ? error.message : "Bridge error" }));
    send(response, status, {
      ...(responseRequestId && { request_id: responseRequestId }),
      error: error instanceof Error ? error.message : "Bridge error",
      ...(error?.retryAfter && { retry_after_seconds: error.retryAfter }),
      ...(status === 429 && { provider_called: false }),
    });
  }
});

async function shutdown() {
  await stopMcp();
  if (loginProcess) loginProcess.kill("SIGTERM");
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

server.listen(port, host, async () => {
  console.log(`Zalo Agent Bridge listening on http://${host}:${port}`);
  if ((await accounts()).length) startMcp();
});
