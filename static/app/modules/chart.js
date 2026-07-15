import { state, lineColors } from './state.js';
import { calculateMetrics } from './metrics.js';

// Match Chart.js canvas font to the app's Inter body font stack.
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.font.size   = 12;

// Re-render the chart when the theme flips so canvas colors track CSS.
window.addEventListener('themechange', () => {
    if (state.currentChart) renderChart();
});

// Y-axis layout mode. Persisted so the choice sticks across reloads.
//   'grouped'     - channels of the same family share one axis (default)
//   'single'      - every channel on one common y-scale
//   'independent' - every channel auto-fits its own range (own axis)
const AXIS_MODE_KEY = 'boostlog_axis_mode';
const VALID_AXIS_MODES = ['grouped', 'single', 'independent'];

export function getAxisMode() {
    const m = localStorage.getItem(AXIS_MODE_KEY);
    return VALID_AXIS_MODES.includes(m) ? m : 'grouped';
}

export function setAxisMode(mode) {
    if (!VALID_AXIS_MODES.includes(mode)) return;
    localStorage.setItem(AXIS_MODE_KEY, mode);
    const sel = document.getElementById('axisModeSelect');
    if (sel && sel.value !== mode) sel.value = mode;
    if (state.currentChart) renderChart();
}

// Padded min/max for an axis from its (unsorted) values, using the
// 1st–99th percentile so outliers don't flatten the line.
function suggestedRange(vals) {
    const sorted = vals.filter(v => v !== null && !isNaN(v)).sort((a, b) => a - b);
    if (sorted.length <= 1) return {};
    const lo = sorted[Math.max(0, Math.floor(sorted.length * 0.01))];
    const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
    const range = hi - lo || Math.abs(hi) || 1;
    return { suggestedMin: lo - range * 0.05, suggestedMax: hi + range * 0.10 };
}

// Robust bounds for the x-axis. Some logs contain a stray sample (e.g. a
// leftover pre-trigger row with Time=799 while the real pull is 0–17s). On a
// linear x-axis that single point stretches the scale and squashes the whole
// curve into a flat sliver. We drop x-values outside 3×IQR of the quartiles,
// which removes only true garbage and never legitimate telemetry.
function robustXBounds(xs) {
    const s = xs.filter(v => v !== null && !isNaN(v)).sort((a, b) => a - b);
    if (s.length < 4) return null;
    const q = p => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    const q1 = q(0.25), q3 = q(0.75);
    const iqr = (q3 - q1) || Math.abs(q3) || 1;
    return { lo: q1 - iqr * 3, hi: q3 + iqr * 3 };
}

// Insights: curated presets surfaced as one-click prompts in the AI chat.
// Clicking one sends `prompt` to the AI, which answers and (via its [GRAPH:]
// replies) pulls up `keywords`. `label` is the compact chip text; `desc` is
// the hover tooltip. See renderChatPresets() in analysis.js.
export const INSIGHT_PRESETS = [
    {
        label: 'Boost Control',
        desc: 'Evaluates whether boost targets are being met and how the wastegate responds.',
        keywords: ['boost', 'wgdc', 'map'],
        prompt: 'How is boost control on this log — is it hitting target, and how does the wastegate (WGDC) respond? Show me the relevant channels.',
    },
    {
        label: 'Driver Demand',
        desc: 'Correlates accelerator pedal and throttle position against engine RPM and speed.',
        keywords: ['accel', 'engine speed', 'throttle angle', 'vehicle speed'],
        prompt: 'How does driver demand (accelerator pedal and throttle) track against engine speed and vehicle speed here? Show the relevant channels.',
    },
    {
        label: 'Fueling / AFR',
        desc: 'Checks if the engine is running lean or rich, plus fuel-pressure delivery.',
        keywords: ['lambda', 'afr', 'stft', 'ltft', 'fuel pressure', 'hpfp', 'lpfp'],
        prompt: 'Is the fueling correct on this log? Check the air-fuel ratio for lean or rich spots, fuel trims, and fuel pressure. Show the relevant channels.',
    },
    {
        label: 'Timing & Knock',
        desc: 'Analyzes ignition timing, per-cylinder corrections, and knock events.',
        keywords: ['ignition', 'knock', 'timing corr'],
        prompt: 'Analyze ignition timing on this log, including per-cylinder timing corrections and any knock events. Show the relevant channels.',
    },
    {
        label: 'Load & Torque',
        desc: 'Compares commanded vs actual load and torque, alongside airflow.',
        keywords: ['load', 'torque at clutch', 'maf'],
        prompt: 'How is load and torque performance on this log? Compare commanded vs actual, and factor in airflow (MAF). Show the relevant channels.',
    },
    {
        label: 'Thermals',
        desc: 'Monitors coolant and intake-air temperatures during the pull.',
        keywords: ['coolant', 'iat'],
        prompt: 'Are the thermal conditions healthy during this pull? Look at coolant and intake-air temperatures. Show the relevant channels.',
    },
    {
        label: 'WGDC & Vanos',
        desc: 'Reviews wastegate duty cycle and its control gains, plus Vanos cam timing.',
        keywords: ['wgdc', 'vanos'],
        prompt: 'Review the wastegate duty cycle (and its control gains) and the Vanos cam timing behavior on this log. Show the relevant channels.',
    },
];

// Render the Insight preset chips above the channel rail. These are pure
// channel selectors (no AI) — clicking one picks that preset's channels.
export function renderRailPresets() {
    const wrap = document.getElementById('railPresets');
    if (!wrap) return;
    if (!state.currentData) { wrap.innerHTML = ''; return; }

    wrap.innerHTML = INSIGHT_PRESETS.map((p, i) => `
        <button type="button" class="preset-chip" data-idx="${i}" title="${p.desc.replace(/"/g, '&quot;')}">${p.label}</button>
    `).join('');

    wrap.querySelectorAll('.preset-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const preset = INSIGHT_PRESETS[Number(chip.dataset.idx)];
            setGraphChannelsByKeywords(preset.keywords, { wholeWord: true });
            wrap.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        });
    });
}

// Theme-aware colors for the canvas (grid / ticks / tooltip / crosshair)
function chartTheme() {
    const light = document.documentElement.dataset.theme === 'light';
    return {
        grid: light ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.04)',
        ticks: light ? 'rgba(15, 23, 42, 0.55)' : 'rgba(255, 255, 255, 0.3)',
        crosshair: light ? 'rgba(15, 23, 42, 0.45)' : 'rgba(255, 255, 255, 0.4)',
        tooltipBg: light ? 'rgba(255, 255, 255, 0.97)' : 'rgba(15, 15, 17, 0.95)',
        tooltipBody: light ? '#0f172a' : '#ffffff',
        tooltipBorder: light ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255,255,255,0.08)',
    };
}

// Builds the custom HTML legend under the chart header. Clicking an item
// removes that series (unchecks the matching parameter toggle).
function renderLegend(items) {
    const legend = document.getElementById('chartLegend');
    if (!legend) return;
    if (!items.length) { legend.innerHTML = ''; return; }

    legend.innerHTML = items.map(it => `
        <button class="chart-legend-item" data-header="${it.header.replace(/"/g, '&quot;')}">
            <span class="chart-legend-dot" style="background:${it.color}; --dot-glow:${it.color}66"></span>
            ${it.header}${it.val !== null ? ` <span class="chart-legend-val">${it.val}</span>` : ''}
        </button>
    `).join('') + '<span class="chart-legend-hint">click to hide</span>';

    legend.querySelectorAll('.chart-legend-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const header = btn.dataset.header;
            const cb = document.querySelector(`#paramToggles input[value="${CSS.escape(header)}"]`);
            if (!cb) return;
            cb.checked = false;
            const lbl = cb.parentElement;
            lbl.style.borderColor = 'var(--border-color)';
            lbl.querySelector('span').style.color = 'inherit';
            document.getElementById('paramToggles').appendChild(lbl);
            renderChart();
        });
    });
}

export function processDataForGraph() {
    const chartOverlay = document.getElementById('chartOverlay');
    const xAxisSelect = document.getElementById('xAxisSelect');
    const paramToggles = document.getElementById('paramToggles');

    chartOverlay.style.display = 'none';

    const fab = document.getElementById('fabAi');
    if (fab) fab.disabled = !state.currentData;

    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.classList.contains('collapsed')) {
        sidebar.classList.add('collapsed');
    }
    const sidebarEl = document.querySelector('.sidebar');
    if (sidebarEl && sidebarEl.classList.contains('open') && window.innerWidth <= 768) {
        sidebarEl.classList.remove('open');
        document.getElementById('sidebarOverlay')?.classList.remove('open');
    }

    xAxisSelect.innerHTML = '';
    state.currentHeaders.forEach(header => {
        const option = document.createElement('option');
        option.value = header;
        option.textContent = header;
        xAxisSelect.appendChild(option);
    });

    const timeCol = state.currentHeaders.find(h => h.toLowerCase().includes('time'));
    const rpmCol = state.currentHeaders.find(h => h.toLowerCase() === 'rpm');
    if (timeCol) xAxisSelect.value = timeCol;
    else if (rpmCol) xAxisSelect.value = rpmCol;

    paramToggles.innerHTML = '';
    const searchInput = document.getElementById('toggleSearch');
    if (searchInput) searchInput.value = '';

    const interestingCols = state.currentHeaders.filter(h => {
        const lh = h.toLowerCase();
        return (lh.includes('boost') || lh.includes('rpm') || lh.includes('timing') || lh.includes('afr') || lh.includes('hpf'));
    });

    state.currentHeaders.forEach((header, index) => {
        if (header === xAxisSelect.value) return;

        const color = lineColors[index % lineColors.length];
        const isDefaultChecked = interestingCols.slice(0, 4).includes(header);

        const lbl = document.createElement('label');
        lbl.className = 'toggle-label';
        lbl.dataset.color = color;
        lbl.style.borderColor = isDefaultChecked ? color : 'var(--border-color)';

        lbl.innerHTML = `
            <input type="checkbox" value="${header}" ${isDefaultChecked ? 'checked' : ''}>
            <span style="color: ${isDefaultChecked ? color : 'inherit'}">${header}</span>
        `;

        const cb = lbl.querySelector('input');
        cb.addEventListener('change', () => {
            lbl.style.borderColor = cb.checked ? color : 'var(--border-color)';
            lbl.querySelector('span').style.color = cb.checked ? color : 'inherit';
            if (cb.checked) paramToggles.prepend(lbl);
            else paramToggles.appendChild(lbl);
            renderChart();
        });

        paramToggles.appendChild(lbl);
    });

    paramToggles.querySelectorAll('input:checked').forEach(cb => paramToggles.prepend(cb.parentElement));

    // Bind once; safe to re-bind via stored flag
    if (!xAxisSelect._renderBound) {
        xAxisSelect.addEventListener('change', renderChart);
        xAxisSelect._renderBound = true;
    }

    // Reflect the persisted axis mode in the inline toggle and bind it once.
    const axisModeSelect = document.getElementById('axisModeSelect');
    if (axisModeSelect) {
        axisModeSelect.value = getAxisMode();
        if (!axisModeSelect._renderBound) {
            axisModeSelect.addEventListener('change', () => setAxisMode(axisModeSelect.value));
            axisModeSelect._renderBound = true;
        }
    }

    calculateMetrics();
    renderChart();
    renderRailPresets();

    document.getElementById('btnAnalyze').disabled = state.analysisRunning;
}

export function renderChart() {
    const xAxisSelect = document.getElementById('xAxisSelect');
    const paramToggles = document.getElementById('paramToggles');

    if (state.currentChart) state.currentChart.destroy();

    const xCol = xAxisSelect.value;
    const labels = state.currentData.map(row => row[xCol]);

    const datasets = [];
    const checkboxes = paramToggles.querySelectorAll('input:checked');

    document.querySelectorAll('#paramToggles span').forEach(span => {
        const baseName = span.parentElement.querySelector('input').value;
        span.textContent = baseName;
    });

    const stackMeta = {
        'y-perf':   { color: '#3A86FF', label: 'PERFORMANCE',   position: 'left'  },
        'y-fuel':   { color: '#38B000', label: 'FUELING (LOW)',  position: 'left'  },
        'y-engine': { color: '#FFBE0B', label: 'ENGINE/SPEED',   position: 'right' },
        'y-tuning': { color: '#FF006E', label: 'TUNING/IGN',     position: 'right' },
        'y-hp':     { color: '#FF7000', label: 'FUEL (HIGH)',    position: 'right' },
    };

    const t = chartTheme();
    const mode = getAxisMode();
    const legendItems = [];

    const scalesConfig = {
        x: {
            type: 'linear',
            grid: { color: t.grid },
            ticks: { color: t.ticks, maxTicksLimit: 12 }
        }
    };

    // First pass: gather per-series info (data, family, values) so shared
    // axes (single/grouped) can pool ranges across their members.
    const series = [];
    checkboxes.forEach((cb) => {
        const header = cb.value;
        const color = lineColors[state.currentHeaders.indexOf(header) % lineColors.length];

        const data = state.currentData.map(row => {
            const xVal = parseFloat(row[xCol]);
            const yVal = parseFloat(row[header]);
            return {
                x: isNaN(xVal) ? null : xVal,
                y: isNaN(yVal) ? null : yVal
            };
        }).filter(pt => pt.x !== null);

        const lh = header.toLowerCase();
        const isHighPress = lh.includes('hpfp') || lh.includes('rail pressure') ||
                            (lh.includes('fuel pressure') && lh.includes('high')) ||
                            lh.includes('di pressure');

        let stackID = 'y-perf';
        if (lh.includes('rpm') || lh.includes('speed')) stackID = 'y-engine';
        else if (lh.includes('timing') || lh.includes('corr') || lh.includes('angle')) stackID = 'y-tuning';
        else if (isHighPress) stackID = 'y-hp';
        else if (lh.includes('afr') || lh.includes('lambda') || lh.includes('fuel') ||
                 lh.includes('stft') || lh.includes('ltft')) stackID = 'y-fuel';

        series.push({ cb, header, color, data, lh, isHighPress, stackID });
    });

    // Drop stray x-axis outliers (see robustXBounds) so a single bad sample
    // can't squash the real curve. Bounds are pooled across all series since
    // they all share the same x column, then re-derive each series' y values.
    const xb = robustXBounds(series.flatMap(s => s.data.map(pt => pt.x)));
    series.forEach(s => {
        if (xb) s.data = s.data.filter(pt => pt.x >= xb.lo && pt.x <= xb.hi);
        s.validVals = s.data.map(pt => pt.y).filter(v => v !== null);
    });

    // Which axis each series lands on, depending on the mode.
    const axisIdFor = (s) => {
        if (mode === 'single') return 'y';
        if (mode === 'grouped') return s.stackID;
        return 'y_' + s.header.replace(/[^a-zA-Z0-9]/g, '_'); // independent: one per series
    };

    // Group series by axis so we can pool ranges and pick a representative
    // (first-seen) member for each axis's position/color/label.
    const axes = {};
    series.forEach(s => {
        const id = axisIdFor(s);
        (axes[id] || (axes[id] = { members: [] })).members.push(s);
    });

    // In independent mode we still only *display* one axis per family to avoid
    // a wall of axes; other channels of that family share its ticks visually.
    const shownFamilies = new Set();
    let gridDrawn = false;

    Object.entries(axes).forEach(([axisId, group]) => {
        const rep = group.members[0];
        const pooled = suggestedRange(group.members.flatMap(m => m.validVals));

        let position, tickColor, display;
        if (mode === 'single') {
            position = 'left';
            tickColor = t.ticks;
            display = true;
        } else {
            const meta = stackMeta[rep.stackID];
            position = meta.position;
            tickColor = meta.color;
            if (mode === 'grouped') {
                display = true;
            } else { // independent
                display = !shownFamilies.has(rep.stackID);
                if (display) shownFamilies.add(rep.stackID);
            }
        }

        // Draw the chart-area grid from only the first visible axis so the
        // gridlines from multiple axes don't stack into visual noise.
        const drawGrid = display && !gridDrawn;
        if (drawGrid) gridDrawn = true;

        scalesConfig[axisId] = {
            type: 'linear',
            display,
            position,
            grid: drawGrid ? { color: t.grid } : { drawOnChartArea: false },
            ticks: display ? { color: tickColor } : { display: false },
            title: { display: false },
            ...pooled
        };
    });

    // Second pass: build datasets + legend/peak labels.
    series.forEach(s => {
        const isWhole = s.lh.includes('rpm') || s.isHighPress || s.lh.includes('speed');
        let peakLabel = null;
        if (s.validVals.length > 0) {
            const maxVal = Math.max(...s.validVals);
            peakLabel = maxVal.toFixed(isWhole ? 0 : 1);
            const span = s.cb.parentElement.querySelector('span');
            if (span) span.textContent = `${s.header} ↗ ${peakLabel}`;
        }

        legendItems.push({ header: s.header, color: s.color, val: peakLabel });

        datasets.push({
            label: s.header,
            data: s.data,
            borderColor: s.color,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.4,
            spanGaps: true,
            yAxisID: axisIdFor(s)
        });
    });

    const ctx = document.getElementById('mainChart').getContext('2d');

    const verticalLinePlugin = {
        id: 'verticalLine',
        afterDraw: (chart) => {
            if (chart.tooltip?._active?.length) {
                const x = chart.tooltip._active[0].element.x;
                const ctx = chart.ctx;
                ctx.save();
                ctx.beginPath();
                ctx.setLineDash([5, 5]);
                ctx.moveTo(x, chart.chartArea.top);
                ctx.lineTo(x, chart.chartArea.bottom);
                ctx.lineWidth = 1;
                ctx.strokeStyle = t.crosshair;
                ctx.stroke();
                ctx.restore();
            }
        }
    };

    state.currentChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        plugins: [verticalLinePlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: t.tooltipBg,
                    titleColor: '#8338EC',
                    bodyColor: t.tooltipBody,
                    padding: 12,
                    borderColor: t.tooltipBorder,
                    borderWidth: 1,
                    bodySpacing: 4
                },
                decimation: { enabled: true, algorithm: 'lttb', samples: 500 }
            },
            scales: scalesConfig
        }
    });

    renderLegend(legendItems);
}

export function toggleAllParams(checked) {
    const checkboxes = document.querySelectorAll('#paramToggles input[type="checkbox"]');
    checkboxes.forEach(cb => {
        const lbl = cb.parentElement;
        if (lbl.style.display !== 'none') {
            cb.checked = checked;
            const color = lbl.dataset.color;
            lbl.style.borderColor = checked ? color : 'var(--border-color)';
            lbl.querySelector('span').style.color = checked ? color : 'inherit';
        }
    });
    renderChart();
    calculateMetrics();
}

/**
 * Sets graph channels based on keywords.
 * @param {string[]} keywords - List of keywords to match against channel names.
 * @param {object} [opts]
 * @param {boolean} [opts.wholeWord] - Match keywords on word boundaries only,
 *   so "iat" won't match "deviation" and "map" won't match "clamp". Used by
 *   Insight presets; the default substring behavior is kept for the AI path.
 */
export function setGraphChannelsByKeywords(keywords, { wholeWord = false } = {}) {
    if (!keywords || keywords.length === 0) return;

    const matchers = keywords.map(k => {
        const kw = k.toLowerCase();
        if (!wholeWord) return (text) => text.includes(kw);
        const re = new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
        return (text) => re.test(text);
    });

    const checkboxes = document.querySelectorAll('#paramToggles input[type="checkbox"]');
    const paramToggles = document.getElementById('paramToggles');
    let matchedAny = false;

    // First pass: uncheck everything and reset styles
    checkboxes.forEach(cb => {
        cb.checked = false;
        const lbl = cb.parentElement;
        lbl.style.borderColor = 'var(--border-color)';
        lbl.querySelector('span').style.color = 'inherit';
    });

    // Second pass: check matches and move to top
    checkboxes.forEach(cb => {
        const labelText = cb.value.toLowerCase();
        const shouldBeChecked = matchers.some(m => m(labelText));

        if (shouldBeChecked) {
            cb.checked = true;
            matchedAny = true;
            const lbl = cb.parentElement;
            const color = lbl.dataset.color;
            lbl.style.borderColor = color;
            lbl.querySelector('span').style.color = color;
            paramToggles.prepend(lbl);
        }
    });

    // Always re-render to reflect the cleared state if we attempted a change
    renderChart();
    calculateMetrics();
}
