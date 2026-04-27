from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.auth.core import get_current_user
from backend.db import get_db
from backend.models import Datalog, Project, User
from backend.schemas import LogMove, ProjectCreate, ProjectUpdate

router = APIRouter()


@router.get("/api/projects")
async def list_projects(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    projects = db.query(Project).filter(
        Project.user_id == current_user.id
    ).order_by(Project.created_at.asc()).all()

    result = []
    for p in projects:
        logs = db.query(Datalog).filter(Datalog.project_id == p.id).all()
        log_count = len(logs)
        last_activity = None
        if logs:
            latest = max(l.uploaded_at for l in logs if l.uploaded_at)
            if latest:
                last_activity = latest.isoformat()
        result.append({
            "id": p.id,
            "name": p.name,
            "vin": p.vin,
            "vehicle_model": p.vehicle_model,
            "customer_name": p.customer_name,
            "notes": p.notes,
            "status": p.status,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "log_count": log_count,
            "last_activity": last_activity,
        })
    return {"projects": result}


@router.post("/api/projects")
async def create_project(payload: ProjectCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name cannot be empty")

    project = Project(
        user_id=current_user.id,
        name=name,
        vin=payload.vin.strip() if payload.vin else None,
        vehicle_model=payload.vehicle_model.strip() if payload.vehicle_model else None,
        customer_name=payload.customer_name.strip() if payload.customer_name else None,
        notes=payload.notes.strip() if payload.notes else None,
        status=payload.status.strip() if payload.status else None,
    )

    db.add(project)
    db.commit()
    db.refresh(project)
    return {
        "id": project.id,
        "name": project.name,
        "vin": project.vin,
        "vehicle_model": project.vehicle_model,
        "customer_name": project.customer_name,
        "notes": project.notes,
        "status": project.status,
        "created_at": project.created_at.isoformat() if project.created_at else None,
    }


@router.put("/api/projects/{project_id}")
async def rename_project(project_id: int, payload: ProjectUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name cannot be empty")
    project.name = name
    db.commit()
    return {"id": project.id, "name": project.name}


@router.delete("/api/projects/{project_id}")
async def delete_project(project_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.query(Datalog).filter(Datalog.project_id == project.id).update({Datalog.project_id: None})
    db.delete(project)
    db.commit()
    return {"deleted": project_id}


@router.put("/api/logs/{log_id}/project")
async def move_log_to_project(log_id: int, payload: LogMove, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    datalog = db.query(Datalog).filter(
        Datalog.id == log_id,
        Datalog.user_id == current_user.id,
    ).first()
    if not datalog:
        raise HTTPException(status_code=404, detail="Log not found")

    if payload.project_id is not None:
        project = db.query(Project).filter(
            Project.id == payload.project_id,
            Project.user_id == current_user.id,
        ).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

    datalog.project_id = payload.project_id
    db.commit()
    return {"id": datalog.id, "project_id": datalog.project_id}


@router.get("/api/projects/{project_id}")
async def get_project_details(project_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {
        "id": project.id,
        "name": project.name,
        "vin": project.vin,
        "vehicle_model": project.vehicle_model,
        "customer_name": project.customer_name,
        "notes": project.notes,
        "status": project.status,
        "created_at": project.created_at.isoformat() if project.created_at else None,
    }


@router.patch("/api/projects/{project_id}")
async def update_project_details(project_id: int, payload: ProjectUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if payload.name is not None:
        project.name = payload.name
    if payload.vin is not None:
        project.vin = payload.vin
    if payload.vehicle_model is not None:
        project.vehicle_model = payload.vehicle_model
    if payload.customer_name is not None:
        project.customer_name = payload.customer_name
    if payload.notes is not None:
        project.notes = payload.notes
    if payload.status is not None:
        project.status = payload.status

    db.commit()
    return {"status": "success"}
