"use client";
import { useEffect, useRef, useState, useCallback } from "react";

export interface CamDevice { deviceId: string; label: string; }

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<CamDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const start = useCallback(async (id?: string, facing?: "user" | "environment") => {
    setError(null);
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      // iOS: phai goi getUserMedia truoc moi co label thiet bi
      const constraints: MediaStreamConstraints = {
        video: id ? { deviceId: { exact: id } } : { facingMode: facing || facingMode },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      // sau khi grant moi enumerate de co label (iOS)
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter((d) => d.kind === "videoinput")
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
      setDevices(cams);
      setReady(true);
    } catch (e: any) {
      setError(e?.message || "Không truy cập được camera. Cần HTTPS hoặc localhost.");
      setReady(false);
    }
  }, [facingMode]);

  const switchCamera = useCallback(() => {
    const next = facingMode === "user" ? "environment" : "user";
    setFacingMode(next);
    setDeviceId(undefined);
    start(undefined, next);
  }, [facingMode, start]);

  const selectDevice = useCallback((id: string) => {
    setDeviceId(id);
    start(id);
  }, [start]);

  // capture frame -> jpeg blob, resize <=960px canh dai
  const capture = useCallback(async (): Promise<Blob | null> => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const maxSide = 960;
    let { videoWidth: w, videoHeight: h } = v;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    canvas.getContext("2d")!.drawImage(v, 0, 0, cw, ch);
    return new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.85));
  }, []);

  // iOS Safari ngat camera khi tab nen -> resume
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && streamRef.current) {
        videoRef.current?.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { videoRef, devices, deviceId, facingMode, error, ready, start, switchCamera, selectDevice, capture };
}
