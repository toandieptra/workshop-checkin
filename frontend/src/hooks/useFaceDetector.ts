"use client";
import { useEffect, useRef, useState } from "react";
import type * as FaceApiType from "@vladmandic/face-api";

export interface DetectedFace {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

let faceApiPromise: Promise<typeof FaceApiType> | null = null;
function loadFaceApi() {
  if (!faceApiPromise) {
    faceApiPromise = import("@vladmandic/face-api").then((m) => m as any);
  }
  return faceApiPromise;
}

export function useFaceDetector(modelUrl = "/models") {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const faceApiRef = useRef<typeof FaceApiType | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const faceapi = await loadFaceApi();
        await faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl);
        if (cancelled) return;
        faceApiRef.current = faceapi;
        setReady(true);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "load face model failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelUrl]);

  const detect = async (
    input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
  ): Promise<DetectedFace[]> => {
    const faceapi = faceApiRef.current;
    if (!faceapi) return [];
    const result = await faceapi.detectAllFaces(
      input,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
    );
    return result.map((r: any, i: number) => ({
      id: i,
      x: r.box.x,
      y: r.box.y,
      w: r.box.width,
      h: r.box.height,
      score: r.score,
    }));
  };

  return { ready, error, detect };
}
