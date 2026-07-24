import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";

const host = process.env.ZALO_BRIDGE_HOST || "0.0.0.0";
const port = Number(process.env.ZALO_BRIDGE_PORT || 18928);
const token = process.env.ZALO_BRIDGE_TOKEN || "";
const mcpHost = process.env.ZALO_MCP_HOST || "0.0.0.0";
const mcpPort = Number(process.env.ZALO_MCP_PORT || 18929);
const mcpToken = process.env.ZALO_MCP_TOKEN || "";
const executable = process.env.ZALO_AGENT_EXECUTABLE || "zalo-agent";
const version = process.env.ZALO_AGENT_VERSION || "1.6.2";
const sessions = new Map();

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
    if (raw.length > 16_384) throw new Error("Request body is too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function parseLastJson(stdout) {
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
      resolve(parseLastJson(stdout));
    });
  });
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
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/health") return send(response, 200, { status: "ok", mcpRunning: Boolean(mcpProcess), mcpHealthy });
    if (!authorized(request)) return send(response, 401, { error: "Unauthorized" });

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
    send(response, 502, { error: error instanceof Error ? error.message : "Bridge error" });
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
