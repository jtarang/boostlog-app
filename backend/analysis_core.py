"""Shared datalog analysis helpers.

Centralizes the Polars WOT aggregation and LLM model resolution so the
`/api/analyze` and `/api/tuning` routers operate on identical numbers instead
of drifting copies.
"""
from __future__ import annotations

import os

import polars as pl


def resolve_llm_model():
    """Return (model_name, api_base) honoring LLM_MODEL (e.g. Bedrock) first,
    then falling back to the local Ollama default."""
    model_name = os.getenv("LLM_MODEL")
    api_base = os.getenv("LLM_API_BASE")
    if not model_name:
        ollama_model = os.getenv("OLLAMA_MODEL", "llama3.2:1b")
        model_name = f"ollama/{ollama_model}"
        api_base = os.getenv("OLLAMA_API_BASE", "http://localhost:11434")
    return model_name, api_base


def _find_col(cols, aliases):
    for c in cols:
        for a in aliases:
            if a.lower() in c.lower():
                return c
    return None


def _wot_frame(df: pl.DataFrame):
    """Filter to wide-open-throttle rows when a pedal channel exists, else the
    full frame. Returns (df_wot, pedal_col)."""
    cols = df.columns
    pedal_col = _find_col(cols, ["pedal", "accelerator", "accel", "throttle"])
    if pedal_col:
        df_wot = df.filter(pl.col(pedal_col) > 80)
        if len(df_wot) < 10:
            df_wot = df  # Fallback if no clear WOT pull found
    else:
        df_wot = df
    return df_wot, pedal_col


def aggregate_wot_summary(file_path: str) -> dict:
    """Aggregate a CSV datalog into a WOT-filtered statistical snapshot.

    This is the canonical summary used for AI analysis. Kept identical to the
    original inline logic in the analyze router so prompts stay stable.
    """
    df = pl.read_csv(file_path, ignore_errors=True)
    cols = df.columns

    rpm_col = _find_col(cols, ["engine rpm", "engine speed", "rpm", "1/min"])
    boost_act_col = _find_col(cols, ["boost pressure (actual)", "map", "manifold absolute pressure"])
    boost_tgt_col = _find_col(cols, ["boost pressure (target)"])
    timing_cols = [c for c in cols if "timing corr" in c.lower()]
    torque_col = _find_col(cols, ["torque at clutch", "torque (actual)"])
    afr_col = _find_col(cols, ["afr", "lambda", "air/fuel"])
    iat_col = _find_col(cols, ["iat", "intake air temp", "charge air temp"])

    df_wot, _ = _wot_frame(df)

    summary = {"total_rows_analyzed": len(df), "wot_rows_analyzed": len(df_wot)}

    if rpm_col:
        summary["max_rpm"] = float(df_wot[rpm_col].max())

    if boost_tgt_col and boost_act_col:
        summary["max_boost_target"] = float(df_wot[boost_tgt_col].max())
        summary["max_boost_actual"] = float(df_wot[boost_act_col].max())

        df_wot = df_wot.with_columns((pl.col(boost_act_col) - pl.col(boost_tgt_col)).alias("boost_error"))
        summary["max_overboost_psi"] = float(df_wot["boost_error"].max())
        summary["max_underboost_psi"] = float(df_wot["boost_error"].min())

        max_boost_row = df_wot.sort(boost_act_col, descending=True).head(1)
        if len(max_boost_row) > 0 and rpm_col:
            summary["rpm_at_max_boost"] = float(max_boost_row[rpm_col][0])
    elif boost_act_col:
        # Boost present without an explicit target channel.
        summary["max_boost_actual"] = float(df_wot[boost_act_col].max())

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

    return summary


def rpm_power_curve(file_path: str, bins: int = 12) -> dict | None:
    """Bin a WOT pull by RPM and return mean torque + estimated crank power per
    band, for charting the power/torque curve. Returns None when RPM or torque
    channels are unavailable.

    Power estimate uses the metric relation P(hp) = T(Nm) * N(rpm) / 7127.
    """
    try:
        df = pl.read_csv(file_path, ignore_errors=True)
    except Exception:
        return None

    cols = df.columns
    rpm_col = _find_col(cols, ["engine rpm", "engine speed", "rpm", "1/min"])
    torque_col = _find_col(cols, ["torque at clutch", "torque (actual)", "torque"])
    if not rpm_col or not torque_col:
        return None

    df_wot, _ = _wot_frame(df)
    df_wot = df_wot.select([
        pl.col(rpm_col).cast(pl.Float64, strict=False).alias("rpm"),
        pl.col(torque_col).cast(pl.Float64, strict=False).alias("trq"),
    ]).drop_nulls().filter((pl.col("trq") < 10000) & (pl.col("trq") > 0) & (pl.col("rpm") > 0))

    if len(df_wot) < 5:
        return None

    rmin = float(df_wot["rpm"].min())
    rmax = float(df_wot["rpm"].max())
    if rmax - rmin < 100:
        return None

    step = (rmax - rmin) / bins
    points = []
    for i in range(bins):
        lo = rmin + i * step
        hi = lo + step
        band = df_wot.filter((pl.col("rpm") >= lo) & (pl.col("rpm") < hi if i < bins - 1 else pl.col("rpm") <= hi))
        if len(band) == 0:
            continue
        rpm_mid = round((lo + hi) / 2)
        trq = float(band["trq"].max())  # peak torque in the band traces the envelope
        power = round(trq * rpm_mid / 7127)
        points.append({"rpm": rpm_mid, "torque": round(trq, 1), "power": power})

    if len(points) < 3:
        return None
    return {"points": points, "peak_power_hp": max(p["power"] for p in points)}
