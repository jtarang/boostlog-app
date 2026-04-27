import os
import shutil
import uuid
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from backend import config
from backend.auth.core import get_current_user
from backend.db import get_db
from backend.models import Datalog, User
from backend.schemas import LogRename

router = APIRouter()


@router.post("/api/upload")
async def upload_log(file: UploadFile = File(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed")

    safe_filename = os.path.basename(file.filename)

    existing = db.query(Datalog).filter(
        Datalog.user_id == current_user.id,
        Datalog.source_filename == safe_filename,
    ).first()
    if existing:
        return {
            "message": "Already uploaded",
            "datalog_id": existing.id,
            "id": existing.id,
            "filename": existing.display_name,
            "url": f"/api/logs/{existing.stored_filename}",
            "duplicate": True,
        }

    file_id = str(uuid.uuid4())
    stored_filename = f"{current_user.id}_{file_id}_{safe_filename}"
    file_path = os.path.join(config.UPLOAD_DIR, stored_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    datalog = Datalog(user_id=current_user.id, stored_filename=stored_filename, display_name=safe_filename, source_filename=safe_filename)
    db.add(datalog)
    db.commit()
    db.refresh(datalog)

    return {
        "message": "Upload successful",
        "datalog_id": datalog.id,
        "id": datalog.id,
        "filename": safe_filename,
        "url": f"/api/logs/{stored_filename}",
        "duplicate": False,
    }


@router.get("/api/proxy-csv")
async def proxy_csv(url: str, _current_user: User = Depends(get_current_user)):
    parsed = urlparse(url)
    if parsed.netloc not in ("bootmod3.net", "www.bootmod3.net"):
        raise HTTPException(status_code=400, detail="Only bootmod3.net URLs are supported")
    if not parsed.path.startswith("/dlog"):
        raise HTTPException(status_code=400, detail="Only /dlog paths are supported")

    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        try:
            r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"bootmod3 returned {e.response.status_code}")
        except Exception as e:
            raise HTTPException(status_code=502, detail=str(e))

    content_type = r.headers.get("content-type", "")
    if "html" in content_type:
        raise HTTPException(status_code=502, detail="bootmod3 returned HTML — the log ID may be invalid or private")

    return Response(content=r.content, media_type="text/csv")


@router.get("/api/logs/{filename}")
async def get_log(filename: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    filename = os.path.basename(filename)
    datalog = db.query(Datalog).filter(
        Datalog.stored_filename == filename,
        Datalog.user_id == current_user.id,
    ).first()
    if not datalog:
        raise HTTPException(status_code=403, detail="Not authorized to access this log")

    file_path = os.path.join(config.UPLOAD_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path, filename=datalog.display_name, content_disposition_type="attachment")
    raise HTTPException(status_code=404, detail="File not found")


@router.get("/api/logs")
async def list_logs(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    datalogs = db.query(Datalog).filter(
        Datalog.user_id == current_user.id
    ).order_by(Datalog.uploaded_at.desc()).all()

    return {"logs": [
        {
            "id": d.id,
            "name": d.display_name,
            "url": f"/api/logs/{d.stored_filename}",
            "uploaded_at": d.uploaded_at.isoformat(),
            "project_id": d.project_id,
        }
        for d in datalogs
    ]}


@router.put("/api/logs/{log_id}/rename")
async def rename_log(log_id: int, rename_data: LogRename, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    datalog = db.query(Datalog).filter(
        Datalog.id == log_id,
        Datalog.user_id == current_user.id,
    ).first()

    if not datalog:
        raise HTTPException(status_code=404, detail="Log not found")

    datalog.display_name = rename_data.new_name
    db.commit()

    return {"id": datalog.id, "name": datalog.display_name}
