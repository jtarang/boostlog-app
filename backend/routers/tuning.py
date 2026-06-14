"""AI Tuning Module — compare two real datalogs and generate optimization
recommendations.

`/api/tuning/compare`  → fast, no LLM. Real per-log metrics + power curves.
`/api/tuning/recommend` → runs the LLM (Ollama / Bedrock) to compare the runs.
"""
import asyncio
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend import config
from backend.analysis_core import aggregate_wot_summary, resolve_llm_model, rpm_power_curve
from backend.auth.core import get_current_user
from backend.db import get_db
from backend.models import Datalog, User
from backend.usage import check_usage_limit, record_usage

router = APIRouter()


class CompareRequest(BaseModel):
    baseline: str   # stored_filename
    optimized: str  # stored_filename


def _resolve_log(db: Session, user: User, stored_filename: str) -> Datalog:
    stored_filename = os.path.basename(stored_filename)
    datalog = db.query(Datalog).filter(
        Datalog.stored_filename == stored_filename,
        Datalog.user_id == user.id,
    ).first()
    if not datalog:
        raise HTTPException(status_code=403, detail=f"Not authorized to access log: {stored_filename}")
    file_path = os.path.join(config.UPLOAD_DIR, stored_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Log file not found")
    return datalog


def _metrics_for(file_path: str) -> dict:
    """Distill a WOT summary + curve into the fields the comparison UI charts."""
    summary = aggregate_wot_summary(file_path)
    curve = rpm_power_curve(file_path)

    peak_power = curve["peak_power_hp"] if curve else None
    if peak_power is None and summary.get("max_torque_nm") and summary.get("rpm_at_max_torque"):
        peak_power = round(summary["max_torque_nm"] * summary["rpm_at_max_torque"] / 7127)

    return {
        "max_rpm": summary.get("max_rpm"),
        "max_boost": summary.get("max_boost_actual"),
        "max_torque_nm": summary.get("max_torque_nm"),
        "peak_power_hp": peak_power,
        "min_afr_lambda": summary.get("min_afr_lambda"),
        "worst_timing_correction": summary.get("worst_timing_correction"),
        "curve": curve["points"] if curve else None,
        "summary": summary,
    }


@router.post("/api/tuning/compare")
async def compare_logs(req: CompareRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    base_log = _resolve_log(db, current_user, req.baseline)
    opt_log = _resolve_log(db, current_user, req.optimized)

    base_path = os.path.join(config.UPLOAD_DIR, base_log.stored_filename)
    opt_path = os.path.join(config.UPLOAD_DIR, opt_log.stored_filename)

    try:
        baseline = _metrics_for(base_path)
        optimized = _metrics_for(opt_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compare logs: {str(e)}")

    return {
        "baseline": {"name": base_log.display_name, **baseline},
        "optimized": {"name": opt_log.display_name, **optimized},
    }


@router.post("/api/tuning/recommend")
async def recommend(req: CompareRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    base_log = _resolve_log(db, current_user, req.baseline)
    opt_log = _resolve_log(db, current_user, req.optimized)

    base_path = os.path.join(config.UPLOAD_DIR, base_log.stored_filename)
    opt_path = os.path.join(config.UPLOAD_DIR, opt_log.stored_filename)

    try:
        base_summary = aggregate_wot_summary(base_path)
        opt_summary = aggregate_wot_summary(opt_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to aggregate logs: {str(e)}")

    build = opt_log.build or base_log.build
    build_block = {
        "build_name": build.name if build else "N/A",
        "vehicle_model": build.vehicle_model if build else "N/A",
        "build_notes": build.notes if build else "N/A",
    }

    prompt = f"""You are **Moose** — a seasoned, no-nonsense professional automotive tuner with 20+ years on forced-induction engines. You are comparing two real dyno pulls from the same shop and must produce a focused **optimization plan** to move from the baseline toward the optimized target.

## Build Configuration
```json
{build_block}
```

## BASELINE run — "{base_log.display_name}"
```json
{base_summary}
```

## OPTIMIZED / TARGET run — "{opt_log.display_name}"
```json
{opt_summary}
```

Produce your response in Markdown with these sections, and be specific with numbers and RPM points pulled from the snapshots above:

### 📊 Delta Summary
A short table comparing peak boost, peak torque, worst timing correction, and AFR/Lambda between the two runs, with the delta and whether each change is an improvement or a regression.

### 🎯 Optimization Plan
A **prioritized checklist** (most critical first) of concrete tuning changes to safely close the gap to the target — boost, ignition timing, and fueling. Reference the specific RPM ranges where the runs diverge.

### 🛡️ Safety Verdict
One of: ✅ **SAFE TO RUN**, ⚠️ **PROCEED WITH CAUTION**, or 🚨 **DO NOT RUN** — justified in 2–3 sentences against the timing-correction severity scale (0 to -1.5° safe, -1.5 to -3.0° monitor, worse than -3.0° danger).

Be direct and professional. Bold all severity labels and key values. Do not use filler like "great run"."""

    check_usage_limit(db, current_user)

    mock_response = os.getenv("MOCK_AI_RESPONSE")
    if mock_response:
        model_name = "mock/turbo-tuner"
        result_text = "## Delta Summary\n\n**Verdict**: ✅ Tuning looks good.\n\nThe optimized run shows safe gains over the baseline."
    else:
        from litellm import completion

        model_name, api_base = resolve_llm_model()

        def _run_llm():
            return completion(
                model=model_name,
                api_base=api_base,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                drop_params=True,
            )

        try:
            response = await asyncio.to_thread(_run_llm)
            result_text = response.choices[0].message.content
            record_usage(db, current_user.id, response)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")

    return {"recommendations": result_text, "model": model_name}
