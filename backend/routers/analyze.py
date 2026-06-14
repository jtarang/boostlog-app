import asyncio
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend import config
from backend.analysis_core import aggregate_wot_summary, resolve_llm_model
from backend.auth.core import get_current_user
from backend.db import get_db
from backend.models import Analysis, Datalog, User
from backend.usage import check_usage_limit, record_usage

router = APIRouter()

# Global flag — only one analysis can run at a time across the whole server
_analysis_in_progress: bool = False


@router.post("/api/analyze/{filename}")
async def analyze_log(filename: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    filename = os.path.basename(filename)
    datalog = db.query(Datalog).filter(
        Datalog.stored_filename == filename,
        Datalog.user_id == current_user.id,
    ).first()
    if not datalog:
        raise HTTPException(status_code=403, detail="Not authorized to access this log")

    global _analysis_in_progress
    if _analysis_in_progress:
        raise HTTPException(status_code=429, detail="An analysis is already running. Please wait for it to finish.")

    file_path = os.path.join(config.UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Log file not found")

    _analysis_in_progress = True
    try:
        try:
            summary = aggregate_wot_summary(file_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to aggregate CSV parameters: {str(e)}")

        from litellm import completion

        model_name, api_base = resolve_llm_model()

        prompt = f"""You are **Moose** — a seasoned, no-nonsense professional automotive tuner with 20+ years of experience on forced-induction engines (turbo, supercharged, E85, pump gas). You have just received a highly detailed statistical snapshot of a dyno pull from a real datalog file. Your job is to give the owner an honest, technically precise, and actionable analysis based on these metrics.

---

## Build/Vehicle Configuration
```json
{{
    "build_name": "{datalog.build.name if datalog.build else 'N/A'}",
    "vehicle_model": "{datalog.build.vehicle_model if datalog.build else 'N/A'}",
    "vin": "{datalog.build.vin if datalog.build else 'N/A'}",
    "customer": "{datalog.build.customer_name if datalog.build else 'N/A'}",
    "build_notes": "{datalog.build.notes if datalog.build else 'N/A'}",
    "build_status": "{datalog.build.status if datalog.build else 'N/A'}"
}}
```

---

## Dyno Run Statistical Snapshot (WOT Filtered)
```json
{summary}
```

---

## Your Analysis Must Cover All of the Following Sections

### 1. 🔥 Peak Performance Snapshot
- State peak RPM, peak torque (in Nm and estimated whp if possible), and peak boost (actual).
- Note the RPM at which peak boost and peak torque occur.
- If torque or boost data is missing, clearly flag it.

### 2. 📈 Boost Behavior & Efficiency
- Discuss the boost control based on the max overboost and underboost (boost error) metrics.
- A delta (target - actual) or underboost of more than **-1.5 psi** or overboost of **+1.5 psi** is a boost control concern.
- An error exceeding **3.0 psi** is a **serious boost control failure** — flag it clearly.

### 3. ⚡ Ignition Timing & Knock Assessment
- Review the worst timing correction and the RPM it occurred at.
Use this severity scale for timing correction values (negative = retard due to knock):
| Correction Range | Severity | Label |
|---|---|---|
| 0.0 to -1.5 deg | Normal | ✅ SAFE |
| -1.5 to -3.0 deg | Borderline | ⚠️ MONITOR |
| -3.0 deg or worse | Critical Knock | 🚨 DANGER |

- Report the **worst timing correction observed** and its severity label, and at what RPM it occurred.
- Explain what commonly causes knock at that specific RPM range.
- Note any issues with Intake Air Temp (IAT) or Air/Fuel Ratio (AFR/Lambda) if they appear out of bounds.

### 4. 🛡️ Safety Verdict
Give an overall run verdict in one of three states:
- ✅ **SAFE TO RUN** — No critical issues, minor notes only.
- ⚠️ **PROCEED WITH CAUTION** — Borderline readings. Reduce boost or retest before street/track.
- 🚨 **DO NOT RUN** — Critical knock, severe boost loss, or anomalous data detected. Immediate attention required.

Justify the verdict clearly in 2–3 sentences.

### 5. 🔧 Tuner Action Items
Provide a **prioritized checklist** of specific actions the tuner or owner must take, ordered from most critical to least:
- Be specific (e.g., "Address knock at 4500 RPM by pulling 1 degree of timing" based on the snapshot).
- Include fueling, ignition, and mechanical checks where relevant.
- If data is insufficient for a specific channel, recommend logging it on the next pull.

---

**Format Rules:**
- Use Markdown headers (##, ###), tables, and bullet points.
- Bold all severity labels and key values.
- Do not use filler phrases like "great run" or "impressive numbers" — be direct and professional.
- **Interactive Graphs**: You can trigger the user's graph to show specific data by including the tag `[GRAPH: keyword1, keyword2]` in your response. For example, if you are discussing boost, add `[GRAPH: boost, target]` to show boost-related channels. Use this sparingly but effectively to guide the user.
"""

        # Check usage limit before calling LLM (always, even for mocked runs)
        check_usage_limit(db, current_user)

        mock_response = os.getenv("MOCK_AI_RESPONSE")
        if mock_response:
            result_text = "## AI Analysis\n\n**Verdict**: ✅ Tuning looks good.\n\nEverything is within safe limits."
            model_name = "mock/turbo-tuner"
        else:

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
                # Record usage after successful call
                record_usage(db, current_user.id, response)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")

        analysis = Analysis(datalog_id=datalog.id, model_used=model_name, result_markdown=result_text)
        db.add(analysis)
        db.commit()

        return {"analysis": result_text}
    finally:
        _analysis_in_progress = False


@router.get("/api/analyze/{filename}")
async def get_cached_analysis(filename: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return the most recent saved analysis for a log, if it exists."""
    filename = os.path.basename(filename)
    datalog = db.query(Datalog).filter(
        Datalog.stored_filename == filename,
        Datalog.user_id == current_user.id,
    ).first()
    if not datalog:
        raise HTTPException(status_code=403, detail="Not authorized")

    latest = db.query(Analysis).filter(
        Analysis.datalog_id == datalog.id
    ).order_by(Analysis.created_at.desc()).first()

    if not latest:
        return {"analysis": None}
    return {"analysis": latest.result_markdown, "model": latest.model_used, "created_at": latest.created_at.isoformat()}


@router.get("/api/analyses/{filename}")
async def list_analyses(filename: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return all saved analyses for a log, newest first."""
    filename = os.path.basename(filename)
    datalog = db.query(Datalog).filter(
        Datalog.stored_filename == filename,
        Datalog.user_id == current_user.id,
    ).first()
    if not datalog:
        raise HTTPException(status_code=403, detail="Not authorized")

    analyses = db.query(Analysis).filter(
        Analysis.datalog_id == datalog.id
    ).order_by(Analysis.created_at.desc()).all()

    return {"analyses": [
        {
            "id": a.id,
            "model_used": a.model_used,
            "created_at": a.created_at.isoformat(),
            "result_markdown": a.result_markdown,
        }
        for a in analyses
    ]}
