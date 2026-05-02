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

        pedal_col = find_col(["pedal", "accelerator", "accel", "throttle"])
        afr_col = find_col(["afr", "lambda", "air/fuel"])
        iat_col = find_col(["iat", "intake air temp", "charge air temp"])

        # Filter to WOT if pedal column exists
        if pedal_col:
            # Assuming pedal is 0-100%, check > 80
            df_wot = df.filter(pl.col(pedal_col) > 80)
            if len(df_wot) < 10:
                df_wot = df # Fallback if no WOT pull found
        else:
            df_wot = df

        summary = {"total_rows_analyzed": len(df), "wot_rows_analyzed": len(df_wot)}

        if rpm_col:
            summary["max_rpm"] = float(df_wot[rpm_col].max())

        if boost_tgt_col and boost_act_col:
            summary["max_boost_target"] = float(df_wot[boost_tgt_col].max())
            summary["max_boost_actual"] = float(df_wot[boost_act_col].max())
            
            # Find max overboost and max underboost
            df_wot = df_wot.with_columns((pl.col(boost_act_col) - pl.col(boost_tgt_col)).alias("boost_error"))
            summary["max_overboost_psi"] = float(df_wot["boost_error"].max())
            summary["max_underboost_psi"] = float(df_wot["boost_error"].min())
            
            # Find RPM where max boost occurs
            max_boost_row = df_wot.sort(boost_act_col, descending=True).head(1)
            if len(max_boost_row) > 0 and rpm_col:
                summary["rpm_at_max_boost"] = float(max_boost_row[rpm_col][0])

        if torque_col:
            valid_torque = df_wot.filter((pl.col(torque_col) < 10000))
            if len(valid_torque) > 0:
                summary["max_torque_nm"] = float(valid_torque[torque_col].max())
                max_tq_row = valid_torque.sort(torque_col, descending=True).head(1)
                if rpm_col:
                    summary["rpm_at_max_torque"] = float(max_tq_row[rpm_col][0])

        if afr_col:
            summary["min_afr_lambda"] = float(df_wot[afr_col].min())
            summary["max_afr_lambda"] = float(df_wot[afr_col].max())

        if iat_col:
            summary["max_iat"] = float(df_wot[iat_col].max())

        worst_timing = 0.0
        worst_timing_rpm = None
        for tc in timing_cols:
            min_tc = float(df_wot.select(pl.col(tc).cast(pl.Float64, strict=False)).min().item())
            if min_tc is not None and min_tc < worst_timing:
                worst_timing = min_tc
                if rpm_col:
                    row = df_wot.filter(pl.col(tc) == min_tc).head(1)
                    if len(row) > 0:
                        worst_timing_rpm = float(row[rpm_col][0])
                        
        summary["worst_timing_correction"] = worst_timing
        if worst_timing_rpm:
            summary["rpm_at_worst_timing_correction"] = worst_timing_rpm

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to aggregate CSV parameters: {str(e)}")

    from litellm import completion

    model_name = os.getenv("LLM_MODEL")
    api_base = os.getenv("LLM_API_BASE")
    if not model_name:
        ollama_model = os.getenv("OLLAMA_MODEL", "llama3.2:1b")
        model_name = f"ollama/{ollama_model}"
        api_base = os.getenv("OLLAMA_API_BASE", "http://localhost:11434")

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
