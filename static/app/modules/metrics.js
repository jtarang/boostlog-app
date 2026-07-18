import { state } from './state.js';
import { escapeHtml } from './utils.js';

// Session Metrics are fully user-configurable. Each tile declares how to find
// its channel and how to summarize it across the log. Config is persisted in
// localStorage; the defaults below reproduce the original hardcoded tiles.
//
// Tile shape:
//   label     - display name
//   unit      - suffix shown after the value (optional)
//   decimals  - digits after the decimal point
//   agg       - 'max' | 'min' | 'avg'  (how to summarize the session)
//   match     - channel-name candidates, tried in order (exact match wins,
//               else case-insensitive substring). First hit becomes the source.
//   exclude   - substrings that disqualify a candidate (optional)
//   clampMin/clampMax - ignore readings outside this range (drops sensor junk)
//   drop      - exact sentinel values to ignore (e.g. 16777216)
//   danger    - render the tile in the red "danger" style
const METRICS_KEY = 'boostlog_session_metrics';

export const DEFAULT_METRICS = [
    { label: 'Max Boost',        unit: 'psi', decimals: 1, agg: 'max', match: ['boost'], exclude: ['target'], clampMax: 200 },
    { label: 'Peak RPM',         unit: 'rpm', decimals: 0, agg: 'max', match: ['rpm', 'engine speed'], clampMax: 20000 },
    { label: 'Max Timing Corr.', unit: 'deg', decimals: 1, agg: 'min', match: ['timing corr', 'timing cor'], clampMin: -100, danger: true },
    { label: 'PI Fuel Pressure', unit: 'psi', decimals: 1, agg: 'max', match: ['pi fuel pressure', 'low pressure fuel', 'fuel pressure'], clampMax: 2000 },
    { label: 'Torque at Clutch', unit: 'Nm',  decimals: 0, agg: 'max', match: ['torque at clutch (actual)', 'torque act. clutch', 'torque', 'trq'], exclude: ['status', 'limit', 'limiter'], drop: [1024, 16777216], clampMax: 10000 },
    { label: 'Max Vehicle Speed', unit: 'mph', decimals: 0, agg: 'max', match: ['speed'], exclude: ['engine'], clampMax: 500 },
];

export function getMetricsConfig() {
    try {
        const raw = localStorage.getItem(METRICS_KEY);
        const arr = raw && JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) return arr;
    } catch { /* fall through to defaults */ }
    return DEFAULT_METRICS.map(m => ({ ...m }));
}

export function saveMetricsConfig(cfg) {
    localStorage.setItem(METRICS_KEY, JSON.stringify(cfg));
}

// Resolve a tile's source channel against the current log's headers.
function resolveChannel(tile, headers) {
    const inc = (tile.match || []).map(s => String(s).toLowerCase()).filter(Boolean);
    if (!inc.length) return null;
    const exc = (tile.exclude || []).map(s => String(s).toLowerCase());
    const exact = headers.find(h => inc.includes(h.toLowerCase()));
    if (exact) return exact;
    return headers.find(h => {
        const lh = h.toLowerCase();
        return inc.some(k => lh.includes(k)) && !exc.some(k => lh.includes(k));
    }) || null;
}

// Summarize a channel across the whole log per the tile's aggregation, applying
// its sanity guards (clamp/drop) so sensor junk and sentinels don't win.
function aggregate(tile, data, channel) {
    if (!channel) return null;
    let acc = null, sum = 0, n = 0;
    for (const row of data) {
        const v = parseFloat(row[channel]);
        if (!isFinite(v)) continue;
        if (tile.drop && tile.drop.includes(v)) continue;
        if (tile.clampMax != null && v > tile.clampMax) continue;
        if (tile.clampMin != null && v < tile.clampMin) continue;
        if (tile.agg === 'avg') { sum += v; n++; }
        else if (tile.agg === 'min') { acc = (acc === null || v < acc) ? v : acc; }
        else { acc = (acc === null || v > acc) ? v : acc; }
    }
    if (tile.agg === 'avg') return n ? sum / n : null;
    return acc;
}

const fmt = (v, decimals) => (v == null || !isFinite(v)) ? '--' : v.toFixed(decimals ?? 1);

// Build the tile DOM from config. Cheap; called on log load and after edits.
export function renderMetricTiles() {
    const body = document.getElementById('metricsBody');
    if (!body) return;
    const cfg = getMetricsConfig();
    body.innerHTML = cfg.map((t, i) => `
        <div class="metric-item${t.danger ? ' danger' : ''}">
            <span class="label">${escapeHtml(t.label || 'Metric')}</span>
            <span class="value" id="metricVal-${i}" data-scramble="true">--</span>${t.unit ? ` <span class="unit">${escapeHtml(t.unit)}</span>` : ''}
        </div>
    `).join('');
}

// Compute + display each tile's session summary (max/min/avg over the log).
export function calculateMetrics() {
    const body = document.getElementById('metricsBody');
    if (!body || !state.currentData || !state.currentHeaders) return;

    const cfg = getMetricsConfig();
    if (body.querySelectorAll('.value').length !== cfg.length) renderMetricTiles();

    cfg.forEach((t, i) => {
        const el = document.getElementById(`metricVal-${i}`);
        if (!el) return;
        const channel = resolveChannel(t, state.currentHeaders);
        el.textContent = fmt(aggregate(t, state.currentData, channel), t.decimals);
    });
}

// Show the instantaneous value at the playback cursor for each tile.
export function updateLiveMetrics(row) {
    const body = document.getElementById('metricsBody');
    if (!body || !state.currentHeaders) return;

    const cfg = getMetricsConfig();
    if (body.querySelectorAll('.value').length !== cfg.length) renderMetricTiles();

    cfg.forEach((t, i) => {
        const el = document.getElementById(`metricVal-${i}`);
        if (!el) return;
        const channel = resolveChannel(t, state.currentHeaders);
        const v = channel ? parseFloat(row[channel]) : NaN;
        el.textContent = fmt(v, t.decimals);
    });
}

/* ============================ Editor ============================ */

// Working copy while the editor modal is open. Each entry additionally carries
// `_channel` (currently selected source) and `_origChannel` (what it resolved
// to on open) so we know whether to keep a tile's original sanity guards.
let editorRows = [];

function currentHeaders() {
    return Array.isArray(state.currentHeaders) ? state.currentHeaders : [];
}

export function openMetricsEditor() {
    const modal = document.getElementById('metricsEditorModal');
    if (!modal) return;
    const headers = currentHeaders();
    editorRows = getMetricsConfig().map(t => {
        const ch = resolveChannel(t, headers);
        return { ...t, _channel: ch || '', _origChannel: ch || '' };
    });
    renderEditorRows();
    modal.style.display = 'flex';
}

export function closeMetricsEditor() {
    const modal = document.getElementById('metricsEditorModal');
    if (modal) modal.style.display = 'none';
    editorRows = [];
}

function aggOptions(sel) {
    return ['max', 'min', 'avg'].map(a =>
        `<option value="${a}"${a === sel ? ' selected' : ''}>${a === 'avg' ? 'Average' : a === 'min' ? 'Minimum' : 'Maximum'}</option>`
    ).join('');
}

function channelOptions(sel) {
    const headers = currentHeaders();
    // Keep a selected channel that isn't in this log (config from another car).
    const opts = headers.includes(sel) || !sel ? [...headers] : [sel, ...headers];
    return `<option value="">— none —</option>` +
        opts.map(h => `<option value="${escapeHtml(h)}"${h === sel ? ' selected' : ''}>${escapeHtml(h)}</option>`).join('');
}

function renderEditorRows() {
    const wrap = document.getElementById('metricsEditorRows');
    if (!wrap) return;

    if (!editorRows.length) {
        wrap.innerHTML = `<p class="metrics-editor-empty">No metrics. Add one below.</p>`;
        return;
    }

    wrap.innerHTML = editorRows.map((r, i) => `
        <div class="metrics-editor-row" data-idx="${i}">
            <div class="mer-reorder">
                <button type="button" class="mer-move" data-move="up" title="Move up"${i === 0 ? ' disabled' : ''}>▲</button>
                <button type="button" class="mer-move" data-move="down" title="Move down"${i === editorRows.length - 1 ? ' disabled' : ''}>▼</button>
            </div>
            <input type="text" class="mer-label input-modern" value="${escapeHtml(r.label || '')}" placeholder="Label" aria-label="Label">
            <select class="mer-channel select-modern" aria-label="Channel">${channelOptions(r._channel)}</select>
            <select class="mer-agg select-modern" aria-label="Aggregation">${aggOptions(r.agg || 'max')}</select>
            <input type="number" class="mer-decimals input-modern" value="${r.decimals ?? 1}" min="0" max="4" aria-label="Decimals" title="Decimal places">
            <input type="text" class="mer-unit input-modern" value="${escapeHtml(r.unit || '')}" placeholder="unit" aria-label="Unit">
            <label class="mer-danger" title="Highlight red"><input type="checkbox" ${r.danger ? 'checked' : ''}> red</label>
            <button type="button" class="mer-remove" title="Remove metric">✕</button>
        </div>
    `).join('');

    wrap.querySelectorAll('.metrics-editor-row').forEach(rowEl => {
        const idx = Number(rowEl.dataset.idx);
        rowEl.querySelectorAll('.mer-move').forEach(btn => {
            btn.addEventListener('click', () => {
                syncEditorFromDOM();
                const to = btn.dataset.move === 'up' ? idx - 1 : idx + 1;
                if (to < 0 || to >= editorRows.length) return;
                [editorRows[idx], editorRows[to]] = [editorRows[to], editorRows[idx]];
                renderEditorRows();
            });
        });
        rowEl.querySelector('.mer-remove').addEventListener('click', () => {
            syncEditorFromDOM();
            editorRows.splice(idx, 1);
            renderEditorRows();
        });
    });
}

// Pull the current DOM input values back into editorRows (before any mutate/save
// so in-progress edits aren't lost when we re-render).
function syncEditorFromDOM() {
    const wrap = document.getElementById('metricsEditorRows');
    if (!wrap) return;
    wrap.querySelectorAll('.metrics-editor-row').forEach(rowEl => {
        const i = Number(rowEl.dataset.idx);
        const r = editorRows[i];
        if (!r) return;
        r.label = rowEl.querySelector('.mer-label').value;
        r._channel = rowEl.querySelector('.mer-channel').value;
        r.agg = rowEl.querySelector('.mer-agg').value;
        r.decimals = Math.max(0, Math.min(4, parseInt(rowEl.querySelector('.mer-decimals').value, 10) || 0));
        r.unit = rowEl.querySelector('.mer-unit').value;
        r.danger = rowEl.querySelector('.mer-danger input').checked;
    });
}

export function addMetricRow() {
    syncEditorFromDOM();
    editorRows.push({ label: 'New Metric', unit: '', decimals: 1, agg: 'max', match: [], _channel: '', _origChannel: '' });
    renderEditorRows();
}

export function resetMetricsEditor() {
    editorRows = DEFAULT_METRICS.map(t => {
        const ch = resolveChannel(t, currentHeaders());
        return { ...t, _channel: ch || '', _origChannel: ch || '' };
    });
    renderEditorRows();
}

export function saveMetricsEditor() {
    syncEditorFromDOM();

    const cfg = editorRows.map(r => {
        const tile = {
            label: (r.label || '').trim() || 'Metric',
            unit: (r.unit || '').trim(),
            decimals: r.decimals ?? 1,
            agg: r.agg || 'max',
            danger: !!r.danger,
        };
        if (r._channel && r._channel !== r._origChannel) {
            // User re-pointed this tile: use the exact channel, drop the old
            // channel-specific guards (they no longer apply).
            tile.match = [r._channel];
        } else {
            // Unchanged source: preserve original matcher + sanity guards so
            // e.g. the torque tile keeps ignoring its sentinel values.
            tile.match = r.match && r.match.length ? r.match : (r._channel ? [r._channel] : []);
            if (r.exclude) tile.exclude = r.exclude;
            if (r.clampMin != null) tile.clampMin = r.clampMin;
            if (r.clampMax != null) tile.clampMax = r.clampMax;
            if (r.drop) tile.drop = r.drop;
        }
        return tile;
    });

    saveMetricsConfig(cfg);
    renderMetricTiles();
    calculateMetrics();
    closeMetricsEditor();

    // Let settings.js sync the new config to the user's account (decoupled via
    // an event so metrics.js doesn't import settings.js — avoids a cycle).
    window.dispatchEvent(new Event('settingschanged'));
}
