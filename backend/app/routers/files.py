"""Generic file upload — workflow form file fields and user signature images.

Files live under backend/uploads/{purpose}/; no DB table — the generated id is
the stored filename stem, served back via GET /files/{file_id}.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/files", tags=["Files"])

MAX_FILE_SIZE = 25 * 1024 * 1024  # 25MB
ALLOWED_PURPOSES = {"files", "signatures"}

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UPLOAD_ROOT = os.path.join(_BACKEND_DIR, "uploads")


def _safe_ext(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ".bin"
    ext = Path(filename).suffix.lower()
    return ext if len(ext) <= 10 else ".bin"


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    purpose: str = "files",
    user: User = Depends(get_current_user),
):
    if purpose not in ALLOWED_PURPOSES:
        raise HTTPException(status_code=400, detail="不支持的用途")
    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="文件超过 25MB 限制")
    if not data:
        raise HTTPException(status_code=400, detail="空文件")

    target_dir = os.path.join(UPLOAD_ROOT, purpose)
    os.makedirs(target_dir, exist_ok=True)
    file_id = uuid.uuid4()
    stored_name = f"{file_id}{_safe_ext(file.filename)}"
    with open(os.path.join(target_dir, stored_name), "wb") as fh:
        fh.write(data)

    if purpose == "signatures":
        from sqlalchemy import update

        from app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            await db.execute(
                update(User).where(User.id == user.id).values(signature_image=stored_name)
            )
            await db.commit()

    return {
        "id": str(file_id),
        "fileName": file.filename,
        "storedName": stored_name,
        "purpose": purpose,
        "url": f"/api/v1/files/{stored_name}",
    }


@router.get("/{stored_name}")
async def serve_file(stored_name: str, user: User = Depends(get_current_user)):
    # stored_name 形如 <uuid><ext>，限制路径穿越
    if "/" in stored_name or ".." in stored_name:
        raise HTTPException(status_code=400, detail="非法文件名")
    for purpose in ALLOWED_PURPOSES:
        path = Path(os.path.join(UPLOAD_ROOT, purpose, stored_name))
        if path.is_file():
            media_type = "image/png" if path.suffix == ".png" else (
                "image/jpeg" if path.suffix in {".jpg", ".jpeg"} else
                "application/octet-stream"
            )
            return FileResponse(path, media_type=media_type, filename=stored_name)
    raise HTTPException(status_code=404, detail="文件不存在")
