export interface ZaloAgentAccount {
  ownId: string;
  name: string;
  proxy: string | null;
  active?: boolean;
}

export interface ZaloAgentStatus {
  available: boolean;
  loggedIn: boolean;
  ownId: string | null;
  activeAccount: ZaloAgentAccount | null;
  version?: string | null;
  mcpRunning?: boolean;
  mcpHealthy?: boolean;
  mcpStartedAt?: string | null;
  lastError?: string | null;
  error?: string | null;
}

export interface ZaloQrSession {
  sessionId: string;
  status: "waiting" | "connected" | "error" | "expired";
  qrDataUrl?: string | null;
  account?: ZaloAgentAccount | null;
  error?: string | null;
}
