from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.auth.core import get_current_user
from backend.db import get_db
from backend.models import Datalog, Build, User
from backend.schemas import LogMove, BuildCreate, BuildUpdate

router = APIRouter()


@router.get("/api/builds")
async def list_builds(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    builds = db.query(Build).filter(
        Build.user_id == current_user.id
    ).order_by(Build.created_at.asc()).all()

    result = []
    for b in builds:
        logs = db.query(Datalog).filter(Datalog.build_id == b.id).all()
        log_count = len(logs)
        last_activity = None
        if logs:
            latest = max(l.uploaded_at for l in logs if l.uploaded_at)
            if latest:
                last_activity = latest.isoformat()
        result.append({
            "id": b.id,
            "name": b.name,
            "vin": b.vin,
            "vehicle_model": b.vehicle_model,
            "customer_name": b.customer_name,
            "notes": b.notes,
            "status": b.status,
            "created_at": b.created_at.isoformat() if b.created_at else None,
            "log_count": log_count,
            "last_activity": last_activity,
        })
    return {"builds": result}


@router.post("/api/builds")
async def create_build(payload: BuildCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Build name cannot be empty")

    build = Build(
        user_id=current_user.id,
        name=name,
        vin=payload.vin.strip() if payload.vin else None,
        vehicle_model=payload.vehicle_model.strip() if payload.vehicle_model else None,
        customer_name=payload.customer_name.strip() if payload.customer_name else None,
        notes=payload.notes.strip() if payload.notes else None,
        status=payload.status.strip() if payload.status else None,
    )

    db.add(build)
    db.commit()
    db.refresh(build)
    return {
        "id": build.id,
        "name": build.name,
        "vin": build.vin,
        "vehicle_model": build.vehicle_model,
        "customer_name": build.customer_name,
        "notes": build.notes,
        "status": build.status,
        "created_at": build.created_at.isoformat() if build.created_at else None,
    }


@router.put("/api/builds/{build_id}")
async def rename_build(build_id: int, payload: BuildUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    build = db.query(Build).filter(
        Build.id == build_id,
        Build.user_id == current_user.id,
    ).first()
    if not build:
        raise HTTPException(status_code=404, detail="Build not found")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Build name cannot be empty")
    build.name = name
    db.commit()
    return {"id": build.id, "name": build.name}


@router.delete("/api/builds/{build_id}")
async def delete_build(build_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    build = db.query(Build).filter(
        Build.id == build_id,
        Build.user_id == current_user.id,
    ).first()
    if not build:
        raise HTTPException(status_code=404, detail="Build not found")
    db.query(Datalog).filter(Datalog.build_id == build.id).update({Datalog.build_id: None})
    db.delete(build)
    db.commit()
    return {"deleted": build_id}


@router.put("/api/logs/{log_id}/build")
async def move_log_to_build(log_id: int, payload: LogMove, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    datalog = db.query(Datalog).filter(
        Datalog.id == log_id,
        Datalog.user_id == current_user.id,
    ).first()
    if not datalog:
        raise HTTPException(status_code=404, detail="Log not found")

    if payload.build_id is not None:
        build = db.query(Build).filter(
            Build.id == payload.build_id,
            Build.user_id == current_user.id,
        ).first()
        if not build:
            raise HTTPException(status_code=404, detail="Build not found")

    datalog.build_id = payload.build_id
    db.commit()
    return {"id": datalog.id, "build_id": datalog.build_id}


@router.get("/api/builds/{build_id}")
async def get_build_details(build_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    build = db.query(Build).filter(Build.id == build_id, Build.user_id == current_user.id).first()
    if not build:
        raise HTTPException(status_code=404, detail="Build not found")
    return {
        "id": build.id,
        "name": build.name,
        "vin": build.vin,
        "vehicle_model": build.vehicle_model,
        "customer_name": build.customer_name,
        "notes": build.notes,
        "status": build.status,
        "created_at": build.created_at.isoformat() if build.created_at else None,
    }


@router.patch("/api/builds/{build_id}")
async def update_build_details(build_id: int, payload: BuildUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    build = db.query(Build).filter(Build.id == build_id, Build.user_id == current_user.id).first()
    if not build:
        raise HTTPException(status_code=404, detail="Build not found")

    if payload.name is not None:
        build.name = payload.name
    if payload.vin is not None:
        build.vin = payload.vin
    if payload.vehicle_model is not None:
        build.vehicle_model = payload.vehicle_model
    if payload.customer_name is not None:
        build.customer_name = payload.customer_name
    if payload.notes is not None:
        build.notes = payload.notes
    if payload.status is not None:
        build.status = payload.status

    db.commit()
    return {"status": "success"}
