import logging
import os
import re
import uuid
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from backend import storage
from backend.auth.core import get_current_user
from backend.db import get_db
from backend.models import Analysis, Build, Datalog, User
from backend.schemas import LogRename

router = APIRouter()
log = logging.getLogger(__name__)

# Free plan can store up to this many logs; paid tiers are unlimited.
FREE_LOG_LIMIT = 100

# NHTSA's vPIC decoder: free, unlimited, no API key. It's the US DOT's official
# VIN registry, so decode quality is best for US-market vehicles; VINs for
# JDM/EU-only trims often come back with thin (but not necessarily wrong) data.
# No broadly-used free alternative covers non-US markets better, so this is it.
NHTSA_DECODE_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}?format=json"

# vPIC always returns Make in ALL CAPS ("BMW", "FORD", "MERCEDES-BENZ"). title()
# fixes most of those ("Ford", "Mercedes-Benz") but wrecks acronym brands —
# keep those verbatim. BMW especially matters: MHD (the log source that drives
# this whole VIN-build path) is BMW-specific tuning software.
_ACRONYM_MAKES = {"BMW", "GMC"}


def _format_make(raw: str) -> str:
    return raw if raw in _ACRONYM_MAKES else raw.title()


def _extract_vin(data: bytes) -> Optional[str]:
    """Pull the VIN from an MHD log's header. MHD logs carry a `#VIN,<vin>`
    comment line in the padding above the CSV; bm3 logs have no such line, so
    this returns None for them. Only the first few KB (the header) are scanned."""
    head = data[:4096].decode("utf-8-sig", errors="ignore")
    for line in head.splitlines():
        s = line.strip()
        if not s.startswith("#"):
            break  # header comments sit at the very top; stop at the real CSV
        parts = re.split(r"[,\s;:]+", s.lstrip("#").strip())
        if len(parts) >= 2 and parts[0].lower() == "vin":
            candidate = parts[1].strip().upper()
            if re.fullmatch(r"[A-Z0-9]{11,17}", candidate):
                return candidate
    return None


async def _decode_vin(vin: str) -> Optional[str]:
    """Best-effort "YYYY Make Model" lookup via NHTSA's free vPIC API. Returns
    None on any failure (network, timeout, unrecognized VIN) — decoding is a
    nice-to-have, never worth blocking or failing an upload over."""
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.get(NHTSA_DECODE_URL.format(vin=vin))
        res.raise_for_status()
        result = res.json()["Results"][0]
    except Exception:
        log.warning("VIN decode failed for %s", vin, exc_info=True)
        return None

    make = _format_make((result.get("Make") or "").strip())
    model = (result.get("Model") or "").strip()
    year = (result.get("ModelYear") or "").strip()
    if not make:  # nothing usable came back — unrecognized VIN or non-US market
        return None
    label = " ".join(p for p in (year, make, model) if p)
    return label or None


def _build_name(vehicle_label: Optional[str], vin: str) -> str:
    # Always suffix with the last-6 of the VIN — two vehicles of the same
    # year/make/model would otherwise decode to identical, indistinguishable
    # build names.
    suffix = f"…{vin[-6:]}"
    return f"{vehicle_label} {suffix}" if vehicle_label else f"VIN {suffix}"


async def _build_for_vin(db: Session, user: User, vin: str) -> Build:
    """Find this user's build for the VIN, or create one. Keeps every log for a
    given vehicle grouped under a single build automatically."""
    build = db.query(Build).filter(Build.user_id == user.id, Build.vin == vin).first()
    if build is None:
        vehicle_label = await _decode_vin(vin)
        build = Build(
            user_id=user.id,
            vin=vin,
            name=_build_name(vehicle_label, vin),
            vehicle_model=vehicle_label,
            status="active",
        )
        db.add(build)
        db.flush()  # assign build.id without ending the transaction
    elif build.vehicle_model is None:
        # Decode failed (or wasn't available) when this build was first created —
        # retry on later uploads for the same VIN rather than staying blank forever.
        vehicle_label = await _decode_vin(vin)
        if vehicle_label:
            build.vehicle_model = vehicle_label
            if build.name == _build_name(None, vin):
                build.name = _build_name(vehicle_label, vin)
    return build


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

    # Free-plan log cap (paid tiers are unlimited). Checked after the dedup
    # short-circuit so re-uploading an existing log never trips it.
    tier = (current_user.subscription_tier or "free").lower()
    if tier == "free":
        log_count = db.query(Datalog).filter(Datalog.user_id == current_user.id).count()
        if log_count >= FREE_LOG_LIMIT:
            raise HTTPException(
                status_code=402,
                detail=f"Free plan is limited to {FREE_LOG_LIMIT} logs. Upgrade to upload more.",
            )

    data = await file.read()

    # Auto-group MHD logs by vehicle: read the VIN from the header and bind the
    # log to a per-VIN build (created on first sighting).
    build_id = None
    vin = _extract_vin(data)
    if vin:
        build_id = (await _build_for_vin(db, current_user, vin)).id

    file_id = str(uuid.uuid4())
    stored_filename = f"{current_user.id}_{file_id}_{safe_filename}"
    storage.save(stored_filename, data)

    datalog = Datalog(user_id=current_user.id, stored_filename=stored_filename, display_name=safe_filename, source_filename=safe_filename, build_id=build_id)
    db.add(datalog)
    db.commit()
    db.refresh(datalog)

    return {
        "message": "Upload successful",
        "datalog_id": datalog.id,
        "id": datalog.id,
        "filename": safe_filename,
        "url": f"/api/logs/{stored_filename}",
        "build_id": datalog.build_id,
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

    if storage.exists(filename):
        return Response(
            content=storage.read_bytes(filename),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{datalog.display_name}"'},
        )
    raise HTTPException(status_code=404, detail="File not found")


@router.get("/api/logs")
async def list_logs(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    datalogs = db.query(Datalog).filter(
        Datalog.user_id == current_user.id
    ).order_by(Datalog.uploaded_at.desc()).all()

    analyzed_ids = {
        row[0] for row in db.query(Analysis.datalog_id).filter(
            Analysis.datalog_id.in_([d.id for d in datalogs])
        ).distinct()
    }

    return {"logs": [
        {
            "id": d.id,
            "name": d.display_name,
            "url": f"/api/logs/{d.stored_filename}",
            "uploaded_at": d.uploaded_at.isoformat(),
            "recorded_at": d.recorded_at.isoformat() if d.recorded_at else None,
            "build_id": d.build_id,
            "has_analysis": d.id in analyzed_ids,
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


@router.delete("/api/logs/{log_id}")
async def delete_log(log_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    datalog = db.query(Datalog).filter(
        Datalog.id == log_id,
        Datalog.user_id == current_user.id,
    ).first()

    if not datalog:
        raise HTTPException(status_code=404, detail="Log not found")

    # Remove the stored blob (best-effort; the DB row is the source of truth).
    storage.delete(datalog.stored_filename)

    # ORM cascade deletes the log's analyses + chat history; build_id is SET NULL.
    db.delete(datalog)
    db.commit()

    return {"status": "deleted", "id": log_id}
