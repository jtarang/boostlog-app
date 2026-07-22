"""Linked bootmod3 account: connect once, then import datalogs by id.

Endpoints (all require the app's own bearer auth via get_current_user):
  POST   /api/bootmod3/link    {username, password}  -> link the account
  DELETE /api/bootmod3/link                          -> unlink
  GET    /api/bootmod3/status                         -> {linked, email, expired}
  GET    /api/bootmod3/logs                           -> the account's log list
  POST   /api/bootmod3/import  {log_id, build_id?}    -> import one log as a Datalog
"""

from __future__ import annotations

import json
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend import config, storage
from backend.auth.core import get_current_user
from backend.crypto import encrypt, try_decrypt
from backend.db import get_db
from backend.integrations import bootmod3
from backend.models import Build, Datalog, User
from backend.routers.logs import _build_for_vin
from backend.schemas import Bootmod3Import, Bootmod3Link

router = APIRouter(prefix="/api/bootmod3", tags=["bootmod3"])

# bootmod3's /getlogs entry shape isn't contractual (mirrors the defensive
# key-picking in static/app/modules/bootmod3.js normalizeRemoteLogs), so try
# several known key names for the id/VIN/recorded-date of each remote log.
_ID_KEYS = ("id", "_id", "logid", "log_id", "logId", "uuid")
_VIN_KEYS = ("vin", "VIN", "vehicleVin", "vehicle_vin", "carVin", "car_vin")
_DATE_KEYS = (
    "date", "created", "created_at", "createdAt", "createdDate", "dateCreated", "date_created",
    "timestamp", "uploaded_at", "uploadedAt", "dateUploaded", "date_uploaded",
    "uploadDate", "upload_date", "logDate", "log_date", "dateAdded", "added", "time",
)
_DATE_KEY_HINT = re.compile(r"(date|time|created|upload|added)", re.IGNORECASE)


def _remote_log_entries(payload) -> list:
    arr = payload
    if isinstance(arr, dict):
        for key in ("logs", "data", "datalogs", "results"):
            if isinstance(arr.get(key), list):
                return arr[key]
        # Some responses come back as an object keyed by index ("0", "1", ...)
        # rather than a JSON array.
        values = list(arr.values())
        if values and all(isinstance(v, dict) for v in values):
            return values
        return []
    return arr if isinstance(arr, list) else []


def _find_remote_log(payload, log_id: str) -> Optional[dict]:
    """Locate this log's entry in a /getlogs payload by id, trying each known
    id key name."""
    for entry in _remote_log_entries(payload):
        if not isinstance(entry, dict):
            continue
        for key in _ID_KEYS:
            value = entry.get(key)
            if value is not None and str(value) == log_id:
                return entry
    return None


def _pick_vin(entry: dict) -> Optional[str]:
    for key in _VIN_KEYS:
        value = entry.get(key)
        if value:
            candidate = str(value).strip().upper()
            if re.fullmatch(r"[A-Z0-9]{11,17}", candidate):
                return candidate
    return None


def _parse_remote_date(raw) -> Optional[datetime]:
    # bootmod3 dates arrive as ISO strings, epoch (sec/ms), or its own
    # "YYYY-MM-DD HH:MM:SS+0000" shape (space separator, no colon in the UTC
    # offset -- e.g. createdDate on a /getlogs entry) -- parse defensively.
    try:
        if isinstance(raw, (int, float)) or (isinstance(raw, str) and raw.strip().isdigit()):
            n = float(raw)
            if n < 1e12:  # seconds -> ms
                n *= 1000
            return datetime.fromtimestamp(n / 1000, tz=timezone.utc)
        s = str(raw).strip()
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            pass
        for fmt in ("%Y-%m-%d %H:%M:%S%z", "%Y-%m-%dT%H:%M:%S%z"):
            try:
                return datetime.strptime(s, fmt)
            except ValueError:
                continue
        return None
    except (OverflowError, OSError, TypeError):
        return None


def _pick_recorded_at(entry: dict) -> Optional[datetime]:
    now = datetime.now(timezone.utc)

    def plausible(dt: Optional[datetime]) -> Optional[datetime]:
        # Reject implausible values (e.g. a duration landing in 1970, or a count).
        return dt if dt and dt.year >= 2005 and dt <= now + timedelta(days=2) else None

    for key in _DATE_KEYS:
        value = entry.get(key)
        if value in (None, ""):
            continue
        dt = plausible(_parse_remote_date(value))
        if dt:
            return dt

    # Field name wasn't one of the known ones -- fall back to any key whose
    # name looks date-ish and whose value actually parses to a real date
    # (mirrors pickDate() in static/app/modules/bootmod3.js).
    for key, value in entry.items():
        if key in _DATE_KEYS or value in (None, "") or not _DATE_KEY_HINT.search(key):
            continue
        dt = plausible(_parse_remote_date(value))
        if dt:
            return dt
    return None


def _load_tokens(user: User) -> dict | None:
    """Decrypt the stored token blob, or None if not linked / unreadable."""
    raw = try_decrypt(user.bootmod3_tokens)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _is_expired(tokens: dict) -> bool:
    exp = tokens.get("exp")
    return bool(exp) and time.time() >= float(exp)


def _require_linked(user: User) -> dict:
    tokens = _load_tokens(user)
    if not tokens:
        raise HTTPException(status_code=409, detail="No bootmod3 account linked")
    if _is_expired(tokens):
        raise HTTPException(status_code=401, detail="bootmod3 link expired -- please re-link")
    return tokens


@router.post("/link")
async def link_account(
    body: Bootmod3Link,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        tokens = await bootmod3.authenticate(body.username, body.password)
    except bootmod3.Bootmod3Error as e:
        raise HTTPException(status_code=401 if e.auth else 502, detail=str(e))

    current_user.bootmod3_tokens = encrypt(json.dumps(tokens))
    current_user.bootmod3_email = tokens.get("email")
    current_user.bootmod3_linked_at = datetime.now(timezone.utc)
    db.commit()

    return {"linked": True, "email": tokens.get("email")}


@router.delete("/link")
async def unlink_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user.bootmod3_tokens = None
    current_user.bootmod3_email = None
    current_user.bootmod3_linked_at = None
    db.commit()
    return {"linked": False}


@router.get("/status")
async def link_status(current_user: User = Depends(get_current_user)):
    tokens = _load_tokens(current_user)
    if not tokens:
        return {"linked": False}
    return {
        "linked": True,
        "email": current_user.bootmod3_email,
        "linked_at": current_user.bootmod3_linked_at.isoformat()
        if current_user.bootmod3_linked_at
        else None,
        "expired": _is_expired(tokens),
    }


@router.get("/logs")
async def list_account_logs(current_user: User = Depends(get_current_user)):
    tokens = _require_linked(current_user)
    try:
        logs = await bootmod3.list_logs(tokens)
    except bootmod3.Bootmod3Error as e:
        raise HTTPException(status_code=401 if e.auth else 502, detail=str(e))
    return {"logs": logs}


@router.post("/import")
async def import_log(
    body: Bootmod3Import,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tokens = _require_linked(current_user)

    log_id = str(body.log_id).strip()
    if not log_id:
        raise HTTPException(status_code=400, detail="log_id is required")

    if body.build_id is not None:
        build = db.query(Build).filter(
            Build.id == body.build_id, Build.user_id == current_user.id
        ).first()
        if not build:
            raise HTTPException(status_code=404, detail="Build not found")

    source_filename = f"dlog_{log_id}.csv"

    # Same dedup contract as /api/upload: one row per (user, source_filename).
    existing = db.query(Datalog).filter(
        Datalog.user_id == current_user.id,
        Datalog.source_filename == source_filename,
    ).first()
    if existing:
        return {
            "message": "Already imported",
            "datalog_id": existing.id,
            "id": existing.id,
            "filename": existing.display_name,
            "url": f"/api/logs/{existing.stored_filename}",
            "duplicate": True,
        }

    try:
        content = await bootmod3.download_log(tokens, log_id)
    except bootmod3.Bootmod3Error as e:
        raise HTTPException(status_code=401 if e.auth else 502, detail=str(e))

    if not content or b"," not in content or b"\n" not in content:
        raise HTTPException(status_code=502, detail="Imported file does not look like a CSV")

    # Auto-group by vehicle and capture the log's real recording date, mirroring
    # the MHD add-to-garage flow in routers/logs.py: bm3 carries the VIN/date in
    # /getlogs rather than the CSV itself, so look this log's entry up there.
    # Best-effort -- a metadata hiccup shouldn't block an import that already
    # downloaded fine.
    build_id = body.build_id
    recorded_at = None
    try:
        remote_logs = await bootmod3.list_logs(tokens)
    except bootmod3.Bootmod3Error:
        remote_logs = None
    entry = _find_remote_log(remote_logs, log_id) if remote_logs is not None else None
    if entry:
        if build_id is None:
            vin = _pick_vin(entry)
            if vin:
                build_id = (await _build_for_vin(db, current_user, vin)).id
        recorded_at = _pick_recorded_at(entry)

    file_id = str(uuid.uuid4())
    stored_filename = f"{current_user.id}_{file_id}_{source_filename}"
    storage.save(stored_filename, content)

    datalog = Datalog(
        user_id=current_user.id,
        build_id=build_id,
        stored_filename=stored_filename,
        display_name=source_filename,
        source_filename=source_filename,
        recorded_at=recorded_at,
    )
    db.add(datalog)
    db.commit()
    db.refresh(datalog)

    return {
        "message": "Import successful",
        "datalog_id": datalog.id,
        "id": datalog.id,
        "filename": source_filename,
        "url": f"/api/logs/{stored_filename}",
        "build_id": datalog.build_id,
        "duplicate": False,
    }
