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
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend import config, storage
from backend.auth.core import get_current_user
from backend.crypto import encrypt, try_decrypt
from backend.db import get_db
from backend.integrations import bootmod3
from backend.models import Build, Datalog, User
from backend.schemas import Bootmod3Import, Bootmod3Link

router = APIRouter(prefix="/api/bootmod3", tags=["bootmod3"])


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

    file_id = str(uuid.uuid4())
    stored_filename = f"{current_user.id}_{file_id}_{source_filename}"
    storage.save(stored_filename, content)

    datalog = Datalog(
        user_id=current_user.id,
        build_id=body.build_id,
        stored_filename=stored_filename,
        display_name=source_filename,
        source_filename=source_filename,
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
        "duplicate": False,
    }
