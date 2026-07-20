// AI Tuning Module — compares two real datalogs and surfaces AI optimization
// recommendations. Charts are driven by /api/tuning/compare (fast, no LLM);
// the recommendations panel calls /api/tuning/recommend (real Ollama/Bedrock).
import { state } from './state.js';
import { getAuthHeaders, escapeHtml } from './utils.js';
import { showToast } from './toast.js';

const charts = { comparison: null, predictive: null, gain: null };
let compareData = null;            // last /compare response
let selectedBaseline = null;       // stored_filename
let selectedOptimized = null;      // stored_filename

export function preSelectTuningLogs(baseline, optimized) {
    selectedBaseline = baseline;
    selectedOptimized = optimized;
}

// Redraw on theme/palette flips so canvas colors track CSS.
window.addEventListener('themechange', () => {
    if (state.currentView === 'tuning' && compareData) drawCharts();
});

function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function tuningTheme() {
    const light = document.documentElement.dataset.theme === 'light';
    return {
        grid: light ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.05)',
        ticks: light ? 'rgba(15, 23, 42, 0.55)' : 'rgba(255, 255, 255, 0.4)',
        tooltipBg: light ? 'rgba(255, 255, 255, 0.97)' : 'rgba(15, 15, 17, 0.95)',
        tooltipBody: light ? '#0f172a' : '#ffffff',
        tooltipBorder: light ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255,255,255,0.08)',
        accent: cssVar('--accent') || '#8338EC',
        // Analogous secondaries derived from the active accent — mirrors the
        // CSS --tune-2/--tune-3 tokens so charts harmonize with every palette.
        tune2: shiftHue(cssVar('--accent') || '#8338EC', 30, 72, 60),
        tune3: shiftHue(cssVar('--accent') || '#8338EC', -55, 78, 60),
        muted: cssVar('--text-secondary') || '#8b919e',
    };
}

// Rotate a hex color's hue by `deg`, forcing fixed S/L, returning an hsl()
// string usable on canvas. Matches the CSS `hsl(from --accent calc(h ± n) …)`.
function shiftHue(color, deg, s = 72, l = 60) {
    let r, g, b;
    if (color.startsWith('#') && color.length === 7) {
        r = parseInt(color.slice(1, 3), 16) / 255;
        g = parseInt(color.slice(3, 5), 16) / 255;
        b = parseInt(color.slice(5, 7), 16) / 255;
    } else {
        return color; // non-hex accent — leave as-is
    }
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    h = (h + deg + 360) % 360;
    return `hsl(${h.toFixed(0)}, ${s}%, ${l}%)`;
}

const storedOf = log => log.url.split('/').pop();

// === Entry: build the picker, then load the comparison ===================
export function renderTuning() {
    const logs = state.currentLogs || [];
    const empty = document.getElementById('tuningEmpty');
    const content = document.getElementById('tuningContent');
    const controls = document.getElementById('tuningControls');

    if (logs.length < 2) {
        empty.style.display = 'flex';
        content.style.display = 'none';
        controls.style.display = 'none';
        return;
    }
    empty.style.display = 'none';
    content.style.display = '';
    controls.style.display = 'flex';

    const baseSel = document.getElementById('tuningBaselineSelect');
    const optSel = document.getElementById('tuningOptimizedSelect');
    const stored = logs.map(storedOf);

    // /api/logs returns newest-first → default baseline = oldest, optimized = newest.
    if (!stored.includes(selectedBaseline)) selectedBaseline = stored[stored.length - 1];
    if (!stored.includes(selectedOptimized)) selectedOptimized = stored[0];
    if (selectedBaseline === selectedOptimized) {
        selectedBaseline = stored[stored.length - 1];
        selectedOptimized = stored[0];
    }

    const opts = logs.map(l => `<option value="${escapeHtml(storedOf(l))}">${escapeHtml(l.name)}</option>`).join('');
    baseSel.innerHTML = opts;
    optSel.innerHTML = opts;
    baseSel.value = selectedBaseline;
    optSel.value = selectedOptimized;

    if (!baseSel._bound) {
        baseSel.addEventListener('change', () => { selectedBaseline = baseSel.value; loadComparison(); });
        optSel.addEventListener('change', () => { selectedOptimized = optSel.value; loadComparison(); });
        baseSel._bound = true;

        const kpisToggle = document.getElementById('tuningKpisToggle');
        const kpisBody   = document.getElementById('tuningKpisBody');
        if (kpisToggle && kpisBody) {
            kpisToggle.addEventListener('click', () => {
                const collapsed = kpisBody.classList.toggle('collapsed');
                kpisToggle.setAttribute('aria-expanded', String(!collapsed));
            });
        }
    }

    loadComparison();
}

export function swapTuningLogs() {
    const baseSel = document.getElementById('tuningBaselineSelect');
    const optSel = document.getElementById('tuningOptimizedSelect');
    [selectedBaseline, selectedOptimized] = [optSel.value, baseSel.value];
    baseSel.value = selectedBaseline;
    optSel.value = selectedOptimized;
    loadComparison();
}

async function loadComparison() {
    const content = document.getElementById('tuningContent');
    const loading = document.getElementById('tuningLoading');
    if (content) content.classList.add('is-loading');
    if (loading) loading.style.display = 'flex';

    try {
        const res = await fetch('/api/tuning/compare', {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseline: selectedBaseline, optimized: selectedOptimized }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
        compareData = await res.json();

        drawCharts();
        updateKpis();
        renderRecoHint();
    } catch (err) {
        showToast(`Comparison failed: ${err.message}`, 'error');
    } finally {
        if (content) content.classList.remove('is-loading');
        if (loading) loading.style.display = 'none';
    }
}

// === KPIs from real deltas ==============================================
function updateKpis() {
    const b = compareData.baseline, o = compareData.optimized;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    const haveCurves = Boolean(b.curve && o.curve);
    const basePwr = b.peak_power_hp, optPwr = o.peak_power_hp;
    const gain = (basePwr != null && optPwr != null) ? optPwr - basePwr : null;
    const gainPct = (gain != null && basePwr) ? Math.round((gain / basePwr) * 100) : null;

    set('kpiGain', gain != null ? (gain >= 0 ? `+${gain}` : `${gain}`) : '—');
    set('kpiGainPct', gainPct != null ? `${gainPct >= 0 ? '+' : ''}${gainPct}% vs baseline` : 'no power channel');

    set('kpiConfidence', haveCurves ? '92' : basePwr != null ? '74' : '55');
    set('kpiConfPct', haveCurves ? 'High — full torque trace' : basePwr != null ? 'Medium — peak only' : 'Low — limited channels');

    const retard = Math.abs(o.worst_timing_correction || 0);
    const knock = retard >= 3 ? 'High' : retard >= 1.5 ? 'Watch' : 'Low';
    set('kpiKnock', knock);

    // Optimization score: reward gains, penalize knock. Clamp 1–10.
    let score = 6;
    if (gainPct != null) score += Math.max(-2, Math.min(3, gainPct / 4));
    score -= retard >= 3 ? 3 : retard >= 1.5 ? 1 : 0;
    score = Math.max(1, Math.min(10, score));
    set('kpiScore', score.toFixed(1));
}

// === Charts ==============================================================
function drawCharts() {
    const t = tuningTheme();
    renderComparison(t);
    renderPredictive(t);
    renderGain(t);
}

function comparisonMetrics() {
    const b = compareData.baseline, o = compareData.optimized;
    const items = [];
    const push = (label, unit, bv, ov) => {
        if (bv == null && ov == null) return;
        items.push({ label, unit, base: bv, opt: ov });
    };
    push('Peak Boost', 'psi', b.max_boost, o.max_boost);
    push('Peak Torque', 'Nm', b.max_torque_nm, o.max_torque_nm);
    push('Peak Power', 'hp', b.peak_power_hp, o.peak_power_hp);
    push('Min Lambda', 'λ', b.min_afr_lambda, o.min_afr_lambda);
    const ka = b.worst_timing_correction != null ? Math.abs(b.worst_timing_correction) : null;
    const kb = o.worst_timing_correction != null ? Math.abs(o.worst_timing_correction) : null;
    push('Knock Retard', '°', ka, kb);
    return items;
}

function renderComparison(t) {
    const el = document.getElementById('tuningComparisonChart');
    if (!el) return;
    if (charts.comparison) charts.comparison.destroy();

    const m = comparisonMetrics();
    // Normalize each metric against its own max so mixed units share one axis.
    const norm = (v, hi) => (v == null || !hi) ? 0 : Math.round((v / hi) * 100);
    const his = m.map(x => Math.max(x.base || 0, x.opt || 0) || 1);

    charts.comparison = new Chart(el.getContext('2d'), {
        type: 'bar',
        data: {
            labels: m.map(x => x.label),
            datasets: [
                { label: 'Baseline', data: m.map((x, i) => norm(x.base, his[i])), backgroundColor: hexA(t.muted, 0.55),
                  borderRadius: 5, borderSkipped: false, barPercentage: 0.7, categoryPercentage: 0.7,
                  _raw: m.map(x => x.base), _unit: m.map(x => x.unit) },
                { label: 'Optimized', data: m.map((x, i) => norm(x.opt, his[i])), backgroundColor: t.accent,
                  borderRadius: 5, borderSkipped: false, barPercentage: 0.7, categoryPercentage: 0.7,
                  _raw: m.map(x => x.opt), _unit: m.map(x => x.unit) },
            ],
        },
        options: baseOpts(t, {
            scales: {
                x: { grid: { display: false }, ticks: { color: t.ticks, font: { size: 11 } } },
                y: { beginAtZero: true, max: 100, grid: { color: t.grid }, ticks: { color: t.ticks, callback: v => v + '%' } },
            },
            plugins: {
                tooltip: {
                    ...baseOpts(t).plugins.tooltip,
                    callbacks: {
                        label: (c) => {
                            const raw = c.dataset._raw[c.dataIndex];
                            const unit = c.dataset._unit[c.dataIndex];
                            return `${c.dataset.label}: ${raw == null ? 'n/a' : round1(raw) + ' ' + unit}`;
                        },
                    },
                },
            },
        }),
    });
}

// Use real RPM/power curves; fall back to a shaped curve from peaks if a log
// lacks torque/RPM channels.
function curveFor(side) {
    if (side.curve && side.curve.length) return side.curve;
    if (side.peak_power_hp && side.max_rpm) {
        const peakRpm = side.max_rpm, peakPwr = side.peak_power_hp, pts = [];
        for (let r = 2500; r <= peakRpm; r += 500) {
            const x = r / peakRpm;
            const f = Math.sin(Math.min(x, 1) * Math.PI * 0.62) * 1.04;
            pts.push({ rpm: r, power: Math.round(peakPwr * Math.min(1, f)), torque: Math.round((peakPwr * Math.min(1, f)) * 7127 / r) });
        }
        return pts;
    }
    return [];
}

function noDataState(wrap, msg) {
    wrap.innerHTML = `
        <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:0.5;text-align:center;padding:16px">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
            <p style="margin:0;font-size:12px;font-family:var(--font-mono);line-height:1.5">${msg}</p>
        </div>`;
}

function renderPredictive(t) {
    const el = document.getElementById('tuningPredictiveChart');
    if (!el) return;
    if (charts.predictive) { charts.predictive.destroy(); charts.predictive = null; }

    const baseC = curveFor(compareData.baseline);
    const optC = curveFor(compareData.optimized);

    if (!optC.length && !baseC.length) {
        noDataState(el.parentElement, 'Requires RPM + Torque channels in your logs.<br>Log a WOT pull with both channels to see power curves.');
        return;
    }

    el.parentElement.innerHTML = '<canvas id="tuningPredictiveChart"></canvas>';
    const canvas = document.getElementById('tuningPredictiveChart');
    const pts = (c, k) => c.map(p => ({ x: p.rpm, y: p[k] }));

    charts.predictive = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            datasets: [
                { label: 'Optimized Power', data: pts(optC, 'power'), borderColor: t.accent, borderWidth: 2.5,
                  tension: 0.4, pointRadius: 0, yAxisID: 'yPwr', fill: true, backgroundColor: gradient(canvas, t.accent) },
                { label: 'Baseline Power', data: pts(baseC, 'power'), borderColor: hexA(t.muted, 0.85), borderWidth: 1.5,
                  borderDash: [5, 4], tension: 0.4, pointRadius: 0, yAxisID: 'yPwr' },
                { label: 'Optimized Torque', data: pts(optC, 'torque'), borderColor: t.tune2, borderWidth: 2,
                  tension: 0.4, pointRadius: 0, yAxisID: 'yTrq' },
            ],
        },
        options: baseOpts(t, {
            scales: {
                x: { type: 'linear', grid: { color: t.grid }, ticks: { color: t.ticks, maxTicksLimit: 8, callback: v => Math.round(v) },
                     title: { display: true, text: 'RPM', color: t.muted, font: { size: 10, weight: '700' } } },
                yPwr: { position: 'left', grid: { color: t.grid }, ticks: { color: t.accent },
                        title: { display: true, text: 'POWER (hp)', color: t.accent, font: { size: 10, weight: '700' } } },
                yTrq: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: t.tune2 },
                        title: { display: true, text: 'TORQUE (Nm)', color: t.tune2, font: { size: 10, weight: '700' } } },
            },
        }),
    });
}

function renderGain(t) {
    const el = document.getElementById('tuningGainChart');
    if (!el) return;
    if (charts.gain) { charts.gain.destroy(); charts.gain = null; }

    const baseC = curveFor(compareData.baseline);
    const optC = curveFor(compareData.optimized);

    if (!optC.length) {
        noDataState(el.parentElement, 'Requires power curve data from both logs.<br>Available once RPM + Torque channels are present.');
        return;
    }

    el.parentElement.innerHTML = '<canvas id="tuningGainChart"></canvas>';
    const canvas = document.getElementById('tuningGainChart');

    const interp = (c, x) => {
        if (!c.length) return 0;
        if (x <= c[0].rpm) return c[0].power;
        if (x >= c[c.length - 1].rpm) return c[c.length - 1].power;
        for (let i = 1; i < c.length; i++) {
            if (c[i].rpm >= x) {
                const a = c[i - 1], b = c[i], k = (x - a.rpm) / (b.rpm - a.rpm);
                return a.power + k * (b.power - a.power);
            }
        }
        return c[c.length - 1].power;
    };
    // Sample up to 7 points across the optimized curve and diff vs baseline.
    const sample = optC.length > 7 ? optC.filter((_, i) => i % Math.ceil(optC.length / 7) === 0) : optC;
    const labels = sample.map(p => (p.rpm / 1000).toFixed(1) + 'k');
    const data = sample.map(p => Math.round(p.power - interp(baseC, p.rpm)));
    const peakIdx = data.indexOf(Math.max(...data));

    charts.gain = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Power gain (hp)', data,
                backgroundColor: data.map((_, i) => i === peakIdx ? t.accent : hexA(t.accent, 0.45)),
                borderRadius: 5, borderSkipped: false,
            }],
        },
        options: baseOpts(t, {
            plugins: { ...baseOpts(t).plugins, legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { color: t.ticks },
                     title: { display: true, text: 'RPM', color: t.muted, font: { size: 10, weight: '700' } } },
                y: { grid: { color: t.grid }, ticks: { color: t.ticks, callback: v => (v >= 0 ? '+' : '') + v } },
            },
        }),
    });
}

function baseOpts(t, extra = {}) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { display: true, position: 'top', align: 'end',
                labels: { color: t.muted, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded',
                          font: { size: 11, family: "'Inter', system-ui, sans-serif" } } },
            tooltip: { backgroundColor: t.tooltipBg, titleColor: t.accent, bodyColor: t.tooltipBody,
                       borderColor: t.tooltipBorder, borderWidth: 1, padding: 12, bodySpacing: 4 },
        },
        ...extra,
    };
}

// === AI Recommendations =================================================
function renderRecoHint() {
    const list = document.getElementById('tuningRecoList');
    if (!list) return;
    list.classList.remove('markdown-body');
    list.innerHTML = `
        <div class="tuning-reco-hint">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"></path>
            </svg>
            <p>Charts compare your two runs above.<br>Hit <strong>Generate AI Report</strong> to have <strong>Moose</strong> generate a prioritized optimization plan from this telemetry.</p>
        </div>`;
}

// "Create Module" → runs the real LLM comparison.
export async function generateTuningModule() {
    if (!compareData) { showToast('Select two logs to compare first', 'info'); return; }

    const btn = document.getElementById('btnCreateModule');
    const list = document.getElementById('tuningRecoList');
    if (btn) { btn.classList.add('is-loading'); btn.disabled = true; }
    if (list) {
        list.classList.remove('markdown-body');
        list.innerHTML = `<div class="tuning-reco-hint"><div class="tuning-spinner"></div><p>Moose is comparing the two runs…</p></div>`;
    }
    showToast('Generating optimization plan…', 'info');

    try {
        const res = await fetch('/api/tuning/recommend', {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseline: selectedBaseline, optimized: selectedOptimized }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || res.statusText);

        const clean = (data.recommendations || '').replace(/\[GRAPH:\s*[^\]]+\]/g, '');
        if (list) {
            list.classList.add('markdown-body');
            list.innerHTML = (typeof marked !== 'undefined') ? marked.parse(clean) : escapeHtml(clean);
        }
        showToast('Optimization plan ready', 'success');
    } catch (err) {
        if (list) { list.classList.remove('markdown-body'); list.innerHTML = `<div class="tuning-reco-hint"><p>Couldn't generate a plan: ${escapeHtml(err.message)}</p></div>`; }
        showToast(`AI error: ${err.message}`, 'error');
    } finally {
        if (btn) { btn.classList.remove('is-loading'); btn.disabled = false; }
    }
}

// --- color helpers -------------------------------------------------------
const round1 = v => Math.round(v * 10) / 10;

function hexA(color, alpha) {
    if (color.startsWith('#') && color.length === 7) {
        const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
}

function gradient(canvas, color) {
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height || 260);
    g.addColorStop(0, hexA(color, 0.28));
    g.addColorStop(1, hexA(color, 0));
    return g;
}
