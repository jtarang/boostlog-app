import { state, lineColors } from './state.js';

// Match Chart.js canvas font to the app's Inter body font stack.
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.font.size   = 12;

// Re-render the chart when the theme flips so canvas colors track CSS.
window.addEventListener('themechange', () => {
    if (state.currentChart) renderChart();
});

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

    calculateMetrics();
    renderChart();

    document.getElementById('btnAnalyze').disabled = state.analysisRunning;
}

export function calculateMetrics() {
    let maxB = null, maxR = null, maxT = null, maxTrq = null, maxFuel = null, maxSpd = null;

    const headers = state.currentHeaders;
    const boostCol = headers.find(h => h.toLowerCase().includes('boost') && !h.toLowerCase().includes('target'));
    const rpmCol = headers.find(h => h.toLowerCase() === 'rpm' || h.toLowerCase().includes('engine speed'));
    const timingCol = headers.find(h => h.toLowerCase().includes('timing corr'));
    const torqueCol = headers.find(h => h.toLowerCase().includes('torque at clutch (actual)')) || headers.find(h => h.toLowerCase().includes('torque') || h.toLowerCase().includes('trq'));
    const fuelCol = headers.find(h => h.toLowerCase().includes('pi fuel pressure')) || headers.find(h => h.toLowerCase().includes('low pressure fuel')) || headers.find(h => h.toLowerCase().includes('fuel pressure'));
    const speedCol = headers.find(h => h.toLowerCase().includes('speed') && !h.toLowerCase().includes('engine'));

    state.currentData.forEach(row => {
        if (boostCol) {
            let v = parseFloat(row[boostCol]);
            if (!isNaN(v) && v < 200 && (maxB === null || v > maxB)) maxB = v;
        }
        if (rpmCol) {
            let v = parseFloat(row[rpmCol]);
            if (!isNaN(v) && v < 20000 && (maxR === null || v > maxR)) maxR = v;
        }
        if (timingCol) {
            let v = parseFloat(row[timingCol]);
            if (!isNaN(v) && v > -100 && (maxT === null || v < maxT)) maxT = v;
        }
        if (torqueCol) {
            let v = parseFloat(row[torqueCol]);
            if (!isNaN(v) && v !== 1024 && v !== 16777216 && v < 10000 && (maxTrq === null || v > maxTrq)) maxTrq = v;
        }
        if (speedCol) {
            let v = parseFloat(row[speedCol]);
            if (!isNaN(v) && v < 500 && (maxSpd === null || v > maxSpd)) maxSpd = v;
        }
        if (fuelCol) {
            let v = parseFloat(row[fuelCol]);
            if (!isNaN(v) && v < 2000 && (maxFuel === null || v > maxFuel)) maxFuel = v;
        }
    });

    updateLiveMetrics({
        boostCol, rpmCol, timingCol, torqueCol, fuelCol, speedCol,
        maxB, maxR, maxT, maxTrq, maxFuel, maxSpd
    }, true);
}

// Called during playback to show instantaneous values, or by calculateMetrics to show max values.
export function updateLiveMetrics(rowOrMax, isMax = false) {
    const $ = id => document.getElementById(id);
    
    if (isMax) {
        $('valBoost').textContent = rowOrMax.boostCol && rowOrMax.maxB !== null ? rowOrMax.maxB.toFixed(1) : '--';
        $('valRpm').textContent = rowOrMax.rpmCol && rowOrMax.maxR !== null ? rowOrMax.maxR.toFixed(0) : '--';
        $('valTiming').textContent = rowOrMax.timingCol && rowOrMax.maxT !== null ? rowOrMax.maxT.toFixed(1) : '--';
        $('valTorque').textContent = rowOrMax.torqueCol && rowOrMax.maxTrq !== null ? rowOrMax.maxTrq.toFixed(0) : '--';
        $('valFuelPressure').textContent = rowOrMax.fuelCol && rowOrMax.maxFuel !== null ? rowOrMax.maxFuel.toFixed(1) : '--';
        $('valSpeed').textContent = rowOrMax.speedCol && rowOrMax.maxSpd !== null ? rowOrMax.maxSpd.toFixed(0) : '--';
    } else {
        const headers = state.currentHeaders;
        const boostCol = headers.find(h => h.toLowerCase().includes('boost') && !h.toLowerCase().includes('target'));
        const rpmCol = headers.find(h => h.toLowerCase() === 'rpm' || h.toLowerCase().includes('engine speed'));
        const timingCol = headers.find(h => h.toLowerCase().includes('timing corr'));
        const torqueCol = headers.find(h => h.toLowerCase().includes('torque at clutch (actual)')) || headers.find(h => h.toLowerCase().includes('torque') || h.toLowerCase().includes('trq'));
        const fuelCol = headers.find(h => h.toLowerCase().includes('pi fuel pressure')) || headers.find(h => h.toLowerCase().includes('low pressure fuel')) || headers.find(h => h.toLowerCase().includes('fuel pressure'));
        const speedCol = headers.find(h => h.toLowerCase().includes('speed') && !h.toLowerCase().includes('engine'));

        const vB = boostCol ? parseFloat(rowOrMax[boostCol]) : NaN;
        const vR = rpmCol ? parseFloat(rowOrMax[rpmCol]) : NaN;
        const vT = timingCol ? parseFloat(rowOrMax[timingCol]) : NaN;
        const vTrq = torqueCol ? parseFloat(rowOrMax[torqueCol]) : NaN;
        const vF = fuelCol ? parseFloat(rowOrMax[fuelCol]) : NaN;
        const vS = speedCol ? parseFloat(rowOrMax[speedCol]) : NaN;

        $('valBoost').textContent = !isNaN(vB) ? vB.toFixed(1) : '--';
        $('valRpm').textContent = !isNaN(vR) ? vR.toFixed(0) : '--';
        $('valTiming').textContent = !isNaN(vT) ? vT.toFixed(1) : '--';
        $('valTorque').textContent = !isNaN(vTrq) ? vTrq.toFixed(0) : '--';
        $('valFuelPressure').textContent = !isNaN(vF) ? vF.toFixed(1) : '--';
        $('valSpeed').textContent = !isNaN(vS) ? vS.toFixed(0) : '--';
    }
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
    const legendItems = [];

    const stackPrimaryAxis = {};
    const scalesConfig = {
        x: {
            type: 'linear',
            grid: { color: t.grid },
            ticks: { color: t.ticks, maxTicksLimit: 12 }
        }
    };

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

        const uniqueAxisID = 'y_' + header.replace(/[^a-zA-Z0-9]/g, '_');
        const isPrimary = !stackPrimaryAxis[stackID];
        if (isPrimary) stackPrimaryAxis[stackID] = uniqueAxisID;

        const meta = stackMeta[stackID];

        const validVals = data.map(pt => pt.y).filter(v => v !== null).sort((a, b) => a - b);
        let suggestedMin, suggestedMax;
        if (validVals.length > 1) {
            const lo = validVals[Math.max(0, Math.floor(validVals.length * 0.01))];
            const hi = validVals[Math.min(validVals.length - 1, Math.floor(validVals.length * 0.99))];
            const range = hi - lo || Math.abs(hi) || 1;
            suggestedMin = lo - range * 0.05;
            suggestedMax = hi + range * 0.10;
        }

        scalesConfig[uniqueAxisID] = {
            type: 'linear',
            display: isPrimary,
            position: meta.position,
            grid: isPrimary ? { color: t.grid } : { drawOnChartArea: false },
            ticks: isPrimary ? { color: meta.color } : { display: false },
            title: isPrimary
                ? { display: true, text: meta.label, font: { size: 10, weight: '700', family: "'Inter', system-ui, sans-serif" } }
                : { display: false },
            ...(suggestedMin !== undefined ? { suggestedMin, suggestedMax } : {})
        };

        const isWhole = lh.includes('rpm') || isHighPress || lh.includes('speed');
        let peakLabel = null;
        if (validVals.length > 0) {
            const maxVal = Math.max(...validVals);
            peakLabel = maxVal.toFixed(isWhole ? 0 : 1);
            const span = cb.parentElement.querySelector('span');
            if (span) span.textContent = `${header} ↗ ${peakLabel}`;
        }

        legendItems.push({ header, color, val: peakLabel });

        datasets.push({
            label: header,
            data,
            borderColor: color,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.4,
            spanGaps: true,
            yAxisID: uniqueAxisID
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
 */
export function setGraphChannelsByKeywords(keywords) {
    if (!keywords || keywords.length === 0) return;
    
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
        const shouldBeChecked = keywords.some(k => labelText.includes(k.toLowerCase()));
        
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
