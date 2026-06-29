import io
import os
import threading

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File
from PIL import Image

MODEL_NAME = os.getenv("INSIGHTFACE_MODEL", "buffalo_s")
ORT_PROVIDER = os.getenv("ORT_PROVIDER", "CPUExecutionProvider")
MIN_QUALITY_SCORE = float(os.getenv("MIN_QUALITY_SCORE", "0.30"))

app = FastAPI(title="face-api")

_model = None
_model_lock = threading.Lock()
_model_ready = False


def get_model():
    """Lazy-load buffalo_s. Tai model lan dau co the mat thoi gian (download)."""
    global _model, _model_ready
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:
            from insightface.app import FaceAnalysis
            m = FaceAnalysis(name=MODEL_NAME, providers=[ORT_PROVIDER])
            m.prepare(ctx_id=-1, det_size=(640, 640))
            _model = m
            _model_ready = True
    return _model


def _decode_image(data: bytes) -> np.ndarray:
    img = Image.open(io.BytesIO(data)).convert("RGB")
    arr = np.array(img)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def _quality_score(img: np.ndarray, face) -> float:
    """Diem chat luong [0..1]: ket hop det_score + do net (variance Laplacian) vung mat."""
    x1, y1, x2, y2 = [int(v) for v in face.bbox]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(img.shape[1], x2), min(img.shape[0], y2)
    if x2 <= x1 or y2 <= y1:
        return 0.0
    crop = img[y1:y2, x1:x2]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    sharp = cv2.Laplacian(gray, cv2.CV_64F).var()
    sharp_norm = min(sharp / 200.0, 1.0)  # 200 ~ du net
    det = float(getattr(face, "det_score", 0.0))
    return round(0.5 * det + 0.5 * sharp_norm, 4)


def _largest_face(faces):
    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


@app.get("/health")
async def health():
    # khong block tren model load; bao trang thai san sang cua model
    return {"status": "ok", "model": MODEL_NAME, "model_ready": _model_ready}


@app.post("/face/detect")
async def detect(file: UploadFile = File(...)):
    data = await file.read()
    img = _decode_image(data)
    faces = get_model().get(img)
    if not faces:
        return {"success": False, "error": "no_face"}
    return {
        "success": True,
        "count": len(faces),
        "faces": [
            {"box": [int(v) for v in f.bbox], "det_score": float(f.det_score)}
            for f in faces
        ],
    }


@app.post("/face/quality")
async def quality(file: UploadFile = File(...)):
    data = await file.read()
    img = _decode_image(data)
    faces = get_model().get(img)
    if not faces:
        return {"success": False, "error": "no_face"}
    f = _largest_face(faces)
    return {
        "success": True,
        "box": [int(v) for v in f.bbox],
        "det_score": float(f.det_score),
        "quality_score": _quality_score(img, f),
    }


@app.post("/face/embedding")
async def embedding(file: UploadFile = File(...)):
    data = await file.read()
    img = _decode_image(data)
    faces = get_model().get(img)
    if not faces:
        return {"success": False, "error": "no_face"}
    # nhieu mat -> chon mat lon nhat
    f = _largest_face(faces)
    emb = f.normed_embedding.astype(float).tolist()
    return {
        "success": True,
        "faces": [
            {
                "box": [int(v) for v in f.bbox],
                "det_score": float(f.det_score),
                "embedding": emb,
                "quality_score": _quality_score(img, f),
            }
        ],
    }
