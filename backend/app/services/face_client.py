import httpx
from ..config import settings


async def get_embedding(image_bytes: bytes, filename: str = "frame.jpg") -> dict:
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(
            f"{settings.FACE_API_URL}/face/embedding",
            files={"file": (filename, image_bytes, "image/jpeg")},
        )
        r.raise_for_status()
        return r.json()
