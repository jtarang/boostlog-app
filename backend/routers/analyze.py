import asyncio
import os

import polars as pl
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend import config
from backend.auth.core import get_current_user
from backend.db import get_db
from backend.models import Analysis, Datalog, User

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
        df = pl.read_csv(file_path, ignore_errors=True)
        cols = df.columns

        def find_col(aliases):
            for c in cols:
                for a in aliases:
                    if a.lower() in c.lower():
                        return c
            return None

        rpm_col = find_col(["engine rpm", "rpm"])
        boost_act_col = find_col(["boost pressure (actual)", "map", "manifold absolute pressure"])
        boost_tgt_col = find_col(["boost pressure (target)"])
        timing_cols = [c for c in cols if "timing corr" in c.lower()]
        torque_col = find_col(["torque at clutch", "torque (actual)"])

        summary = {"rows_analyzed": len(df)}

        if rpm_col:
            summary["max_rpm"] = float(df[rpm_col].max())

        if boost_tgt_col and boost_act_col:
            summary["max_boost_target"] = float(df[boost_tgt_col].max())
            summary["max_boost_actual"] = float(df[boost_act_col].max())

        if torque_col:
            valid_torque = df.filter((pl.col(torque_col) < 10000))
            if len(valid_torque) > 0:
                summary["max_torque_nm"] = float(valid_torque[torque_col].max())

        worst_timing = 0.0
        for tc in timing_cols:
            min_tc = float(df.select(pl.col(tc).cast(pl.Float64, strict=False)).min().item())
            if min_tc is not None and min_tc < worst_timing:
                worst_timing = min_tc
        summary["worst_timing_correction"] = worst_timing

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to aggregate CSV parameters: {str(e)}")

    from litellm import completion

    model_name = os.getenv("LLM_MODEL")
    api_base = os.getenv("LLM_API_BASE")
    if not model_name:
        ollama_model = os.getenv("OLLAMA_MODEL", "llama3.2:1b")
        model_name = f"ollama/{ollama_model}"
        api_base = os.getenv("OLLAMA_API_BASE", "http://localhost:11434")

    prompt = f"""You are **Moose** — a seasoned, no-nonsense professional automotive tuner with 20+ years of experience on forced-induction engines (turbo, supercharged, E85, pump gas). You have just received an aggregated data summary parsed from a real dyno datalog file. Your job is to give the owner an honest, technically precise, and actionable analysis.

---

## Dyno Run Summary Data
```
{summary}
```

---

## Your Analysis Must Cover All of the Following Sections

### 1. 🔥 Peak Performance Snapshot
- State peak RPM, peak torque (in Nm and estimated whp if possible), and peak boost (actual).
- Comment on where peak power likely falls in the RPM band based on the data.
- If torque or boost data is missing, clearly flag it.

### 2. 📈 Boost Behavior & Efficiency
- Compare **boost target vs boost actual**. Calculate the delta (target − actual).
- A delta of more than **1.5 psi** is a boost control concern (wastegate, boost solenoid, or plumbing leak).
- A delta of more than **3.0 psi** is a **serious boost control failure** — flag it clearly.
- Comment on whether boost builds linearly (healthy) or spikes/drops (tuning concern).

### 3. ⚡ Ignition Timing & Knock Assessment
Use this severity scale for timing correction values (negative = retard due to knock):
| Correction Range | Severity | Label |
|---|---|---|
| 0.0 to -1.5 deg | Normal | ✅ SAFE |
| -1.5 to -3.0 deg | Borderline | ⚠️ MONITOR |
| -3.0 deg or worse | Critical Knock | 🚨 DANGER |

- Report the **worst timing correction observed** and its severity label.
- If knock is detected mid-pull (not just at peak), flag the RPM window where it occurred.
- Explain what commonly causes knock at that RPM range (heat soak, lean AFR, octane, charge temp).

### 4. 🛡️ Safety Verdict
Give an overall run verdict in one of three states:
- ✅ **SAFE TO RUN** — No critical issues, minor notes only.
- ⚠️ **PROCEED WITH CAUTION** — Borderline readings. Reduce boost or retest before street/track.
- 🚨 **DO NOT RUN** — Critical knock, severe boost loss, or anomalous data detected. Immediate attention required.

Justify the verdict clearly in 2–3 sentences.

### 5. 🔧 Tuner Action Items
Provide a **prioritized checklist** of specific actions the tuner or owner must take, ordered from most critical to least:
- Be specific (e.g., "Reduce boost target by 2 psi between 3500–4500 RPM" not just "reduce boost").
- Include fueling, ignition, and mechanical checks where relevant.
- If data is insufficient for a specific channel, recommend logging it on the next pull.

---

**Format Rules:**
- Use Markdown headers (##, ###), tables, and bullet points.
- Bold all severity labels and key values.
- Do not use filler phrases like "great run" or "impressive numbers" — be direct and professional.
- If the data summary is sparse or missing key channels, state exactly what additional logging is needed.
"""

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
            )

        try:
            response = await asyncio.to_thread(_run_llm)
            result_text = response.choices[0].message.content
        except Exception as e:
            _analysis_in_progress = False
            raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")

    _analysis_in_progress = False

    analysis = Analysis(datalog_id=datalog.id, model_used=model_name, result_markdown=result_text)
    db.add(analysis)
    db.commit()

    return {"analysis": result_text}


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
