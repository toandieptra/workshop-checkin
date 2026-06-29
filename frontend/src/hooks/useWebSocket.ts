"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { WS_URL } from "@/lib/api";

export function useWebSocket(onMessage: (data: any) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    let alive = true;
    let retry: any;

    const connect = () => {
      if (!alive) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        try { cbRef.current(JSON.parse(e.data)); } catch {}
      };
    };
    connect();
    return () => { alive = false; clearTimeout(retry); wsRef.current?.close(); };
  }, []);

  const send = useCallback((obj: any) => {
    wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(obj));
  }, []);

  return { connected, send };
}
