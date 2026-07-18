"""Datalog parsing regression tests.

MHD logs prepend a UTF-8 BOM and several `#`-prefixed padding lines
(#Encoding / #Ecu CALID / #Ecu PRGID / #VIN) before the real header row;
bm3 logs start directly at the header. Both must parse identically.
"""
from backend.analysis_core import aggregate_wot_summary, rpm_power_curve

# MHD-shaped header: BOM + comment padding, then channel names using MHD's
# naming ("Boost (PSI)", "Torque act. clutch (Nm)", "CylN Timing Cor").
MHD_HEADER = (
    "﻿#Encoding: UTF-8\n"
    "#Ecu CALID: 00008318145047\n"
    "#Ecu PRGID: 00005C64145007\n"
    "#VIN: WBS43AY01NFN19011\n"
    "Time,Accel Ped. Pos. (%),Boost (PSI),Boost target RAM (PSI),RPM (rpm),"
    "Torque act. clutch (Nm),Lambda 1 (AFR),Charge air temp. (*F),Cyl1 Timing Cor (*)\n"
)


def _mhd_file(tmp_path, rows):
    body = "".join(",".join(str(v) for v in r) + "\n" for r in rows)
    p = tmp_path / "sample.mhd.csv"
    p.write_text(MHD_HEADER + body, encoding="utf-8")
    return str(p)


def _wot_rows(n=15):
    # Pedal >80 so the WOT filter keeps them; rising boost/rpm/torque.
    return [
        [i * 0.08, 95, 20 + i, 22 + i, 4000 + i * 100, 400 + i * 5,
         13.0, 150 + i, -1.0 - (i % 3)]
        for i in range(n)
    ]


def test_mhd_padding_and_channels(tmp_path):
    f = _mhd_file(tmp_path, _wot_rows())
    summary = aggregate_wot_summary(f)

    # Padding lines and BOM must not be counted as data.
    assert summary["total_rows_analyzed"] == 15
    # MHD-named channels resolve to real numbers.
    assert summary["max_rpm"] == 5400.0
    assert "max_boost_actual" in summary and summary["max_boost_actual"] > 0
    assert "max_torque_nm" in summary and summary["max_torque_nm"] > 0
    assert summary["min_afr_lambda"] > 0
    assert summary["worst_timing_correction"] < 0  # timing "Cor" (single r) detected


def test_mhd_power_curve(tmp_path):
    f = _mhd_file(tmp_path, _wot_rows(30))
    pc = rpm_power_curve(f)
    assert pc is not None
    assert pc["peak_power_hp"] > 0
