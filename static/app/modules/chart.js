import { state, lineColors } from './state.js';

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

    const $ = id => document.getElementById(id);
    $('valBoost').textContent = boostCol && maxB !== null ? maxB.toFixed(1) : '--';
    $('valRpm').textContent = rpmCol && maxR !== null ? maxR.toFixed(0) : '--';
    $('valTiming').textContent = timingCol && maxT !== null ? maxT.toFixed(1) : '--';
    $('valTorque').textContent = torqueCol && maxTrq !== null ? maxTrq.toFixed(0) : '--';
    $('valFuelPressure').textContent = fuelCol && maxFuel !== null ? maxFuel.toFixed(1) : '--';
    $('valSpeed').textContent = speedCol && maxSpd !== null ? maxSpd.toFixed(0) : '--';
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

    const stackPrimaryAxis = {};
    const scalesConfig = {
        x: {
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: { color: 'rgba(255, 255, 255, 0.3)', maxTicksLimit: 12 }
        }
    };

    checkboxes.forEach((cb) => {
        const header = cb.value;
        const color = lineColors[state.currentHeaders.indexOf(header) % lineColors.length];

        const data = state.currentData.map(row => {
            const v = parseFloat(row[header]);
            return isNaN(v) ? null : v;
        });

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

        const validVals = data.filter(v => v !== null).sort((a, b) => a - b);
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
            grid: isPrimary ? { color: 'rgba(255, 255, 255, 0.04)' } : { drawOnChartArea: false },
            ticks: isPrimary ? { color: meta.color } : { display: false },
            title: isPrimary
                ? { display: true, text: meta.label, font: { size: 10, weight: 'bold' } }
                : { display: false },
            ...(suggestedMin !== undefined ? { suggestedMin, suggestedMax } : {})
        };

        const isWhole = lh.includes('rpm') || isHighPress || lh.includes('speed');
        if (validVals.length > 0) {
            const maxVal = Math.max(...validVals);
            const span = cb.parentElement.querySelector('span');
            if (span) span.textContent = `${header} ↗ ${maxVal.toFixed(isWhole ? 0 : 1)}`;
        }

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
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
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
                    backgroundColor: 'rgba(15, 15, 17, 0.95)',
                    titleColor: '#8338EC',
                    padding: 12,
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    bodySpacing: 4
                },
                decimation: { enabled: true, algorithm: 'lttb', samples: 500 }
            },
            scales: scalesConfig
        }
    });
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
