let authToken = localStorage.getItem('boostlog_token') || null;
let authMode = 'login';
let currentServerFile = null;
let currentLogId = null;
let currentRenameId = null;

function setActiveLog(id, name, listItem = null) {
    currentLogId = id;
    // Update page title
    const title = document.getElementById('pageTitle');
    if (title) {
        title.textContent = name || 'Interactive Datalog';
        if (id) {
            title.classList.add('editable');
        } else {
            title.classList.remove('editable');
        }
    }
    // Highlight the sidebar item
    document.querySelectorAll('#logItems li').forEach(li => li.classList.remove('active-log'));
    if (listItem) listItem.classList.add('active-log');
}

// === Sidebar Toggle (Mobile) ===
function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('open');
}

// === AI Drawer Toggle ===
function toggleAiDrawer() {
    document.getElementById('aiDrawer').classList.toggle('open');
    document.getElementById('aiDrawerOverlay').classList.toggle('open');
}

// === Sidebar Collapse (Desktop) ===
function collapseSidebar() {
    document.getElementById('sidebar').classList.toggle('collapsed');
}

// === Collapsible Metrics ===
function toggleMetrics() {
    const body = document.getElementById('metricsBody');
    const chevron = document.getElementById('metricsChevron');
    body.classList.toggle('collapsed');
    chevron.classList.toggle('rotated');
}

// === Filter Parameter Toggles ===
function filterToggles(query) {
    const q = query.toLowerCase().trim();
    const toggles = document.querySelectorAll('#paramToggles .toggle-label');
    toggles.forEach(lbl => {
        const text = lbl.textContent.toLowerCase();
        lbl.style.display = text.includes(q) ? '' : 'none';
    });
}

// === Toast Notifications ===
function showToast(message, type = 'success', duration = 4000) {
    // Remove any existing toast
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;

    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-msg">${message}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
    `;

    document.body.appendChild(toast);

    // Trigger entrance animation
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    // Auto-dismiss after 3000ms (or specified duration)
    const timeout = duration || 3000;
    setTimeout(() => {
        if (toast && toast.parentElement) {
            toast.classList.remove('toast-visible');
            setTimeout(() => toast.remove(), 400); // Wait for transition
        }
    }, timeout);
}

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

function initAuth() {
    if (authToken) {
        const payload = parseJwt(authToken);
        if (payload && payload.sub) {
            const usernameEl = document.getElementById('navUsername');
            if (usernameEl) usernameEl.textContent = payload.sub;
        }
        document.getElementById('authOverlay').style.display = 'none';
        refreshLogList();
    } else {
        document.getElementById('authOverlay').style.display = 'flex';
    }
}

function switchAuthTab(mode) {
    authMode = mode;
    const tabs = document.querySelectorAll('.auth-tabs .tab');
    tabs.forEach(t => t.classList.remove('active'));
    if (mode === 'login') {
        tabs[0].classList.add('active');
        document.getElementById('authSubmitBtn').textContent = 'Login';
    } else {
        tabs[1].classList.add('active');
        document.getElementById('authSubmitBtn').textContent = 'Register';
    }
    document.getElementById('authError').textContent = '';
}

async function handleAuth(e) {
    e.preventDefault();
    const u = document.getElementById('authUsername').value;
    const p = document.getElementById('authPassword').value;
    const errorEl = document.getElementById('authError');
    errorEl.textContent = '';

    try {
        if (authMode === 'register') {
            const res = await fetch('/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u, password: p })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Registration failed');

            // Auto login
            switchAuthTab('login');
            await performLogin(u, p);
        } else {
            await performLogin(u, p);
        }
    } catch (err) {
        errorEl.textContent = err.message;
    }
}

async function performLogin(username, password) {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);

    const res = await fetch('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Login failed');

    authToken = data.access_token;
    localStorage.setItem('boostlog_token', authToken);
    initAuth();
}

function getAuthHeaders() {
    return authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
}

function logout() {
    localStorage.removeItem('boostlog_token');
    window.location.reload();
}

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const logItems = document.getElementById('logItems');
const chartOverlay = document.getElementById('chartOverlay');
const xAxisSelect = document.getElementById('xAxisSelect');
const paramToggles = document.getElementById('paramToggles');

const valBoost = document.getElementById('valBoost');
const valRpm = document.getElementById('valRpm');
const valTiming = document.getElementById('valTiming');
const valTorque = document.getElementById('valTorque');
const valFuelPressure = document.getElementById('valFuelPressure');
const valSpeed = document.getElementById('valSpeed');

let currentChart = null;
let analysisRunning = false;
let analysisRunningFile = null;
let analysisRunningName = null;
let currentData = null; // Store parsed CSV data
let currentHeaders = [];

// Vibrant colors for graphing lines
const lineColors = [
    '#3A86FF', '#FF006E', '#8338EC', '#FFBE0B', '#FB5607',
    '#38B000', '#00F5D4', '#F15BB5', '#9B5DE5', '#00BBF9'
];

// Drag & Drop Handling
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
        handleFile(e.dataTransfer.files[0]);
    }
});

// Mirror drop zone in the chart overlay
const dropZoneOverlay = document.getElementById('dropZoneOverlay');
const fileInputOverlay = document.getElementById('fileInputOverlay');

dropZoneOverlay.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZoneOverlay.classList.add('dragover');
});
dropZoneOverlay.addEventListener('dragleave', () => dropZoneOverlay.classList.remove('dragover'));
dropZoneOverlay.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZoneOverlay.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInputOverlay.addEventListener('change', (e) => {
    if (e.target.files.length) handleFile(e.target.files[0]);
});

// Modal drop zone (id=dropZone is now inside the upload modal)
document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInputModal = document.getElementById('fileInputModal');
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) { closeUploadModal(); handleFile(e.dataTransfer.files[0]); }
        });
    }
    if (fileInputModal) {
        fileInputModal.addEventListener('change', (e) => {
            if (e.target.files.length) { closeUploadModal(); handleFile(e.target.files[0]); }
        });
    }
});

// === Initialization and Events ===
initAuth();

document.addEventListener('DOMContentLoaded', () => {
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
        pageTitle.onclick = () => {
            if (currentLogId) {
                renameLog(currentLogId, pageTitle.textContent);
            }
        };
    }
});

function handleFile(file) {
    if (!file.name.endsWith('.csv')) {
        alert('Please upload a CSV file.');
        return;
    }

    // Set title immediately with filename, ID will be updated once backend responds
    setActiveLog(null, file.name);
    uploadToBackend(file);

    // Parse CSV locally in the browser for instant visualization
    Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function (results) {
            console.log("Parsed CSV:", results.data.length, "rows");
            currentData = results.data;
            currentHeaders = results.meta.fields;

            processDataForGraph();
        },
        error: function (err) {
            console.error("Parse Error:", err);
            alert("Failed to parse CSV locally.");
        }
    });
}

function processDataForGraph() {
    chartOverlay.style.display = 'none';

    // Populate X Axis selector (defaulting to Time or RPM)
    xAxisSelect.innerHTML = '';
    currentHeaders.forEach(header => {
        const option = document.createElement('option');
        option.value = header;
        option.textContent = header;
        xAxisSelect.appendChild(option);
    });

    // Try to auto-select Time or RPM for X axis
    const timeCol = currentHeaders.find(h => h.toLowerCase().includes('time'));
    const rpmCol = currentHeaders.find(h => h.toLowerCase() === 'rpm');
    if (timeCol) xAxisSelect.value = timeCol;
    else if (rpmCol) xAxisSelect.value = rpmCol;

    // Build parameter toggles
    paramToggles.innerHTML = '';
    const searchInput = document.getElementById('toggleSearch');
    if (searchInput) searchInput.value = '';

    // Auto-select some common interesting metrics
    const interestingCols = currentHeaders.filter(h => {
        const lh = h.toLowerCase();
        return (lh.includes('boost') || lh.includes('rpm') || lh.includes('timing') || lh.includes('afr') || lh.includes('hpf'));
    });

    currentHeaders.forEach((header, index) => {
        if (header === xAxisSelect.value) return; // Skip X axis

        const color = lineColors[index % lineColors.length];
        const isDefaultChecked = interestingCols.slice(0, 4).includes(header); // Pick up to 4 defaults

        const lbl = document.createElement('label');
        lbl.className = 'toggle-label';
        lbl.dataset.color = color;
        lbl.style.borderColor = isDefaultChecked ? color : 'var(--border-color)';

        lbl.innerHTML = `
            <input type="checkbox" value="${header}" ${isDefaultChecked ? 'checked' : ''}>
            <span style="color: ${isDefaultChecked ? color : 'inherit'}">${header}</span>
        `;

        // Handle checkbox change
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

    xAxisSelect.addEventListener('change', renderChart);

    // Calculate simple metrics for the UI metrics card
    calculateMetrics();
    renderChart();

    document.getElementById('btnAnalyze').disabled = analysisRunning;
}

function calculateMetrics() {
    let maxB = null;
    let maxR = null;
    let maxT = null;
    let maxTrq = null;
    let maxFuel = null;
    let maxSpd = null;

    const boostCol = currentHeaders.find(h => h.toLowerCase().includes('boost') && !h.toLowerCase().includes('target'));
    const rpmCol = currentHeaders.find(h => h.toLowerCase() === 'rpm' || h.toLowerCase().includes('engine speed'));
    const timingCol = currentHeaders.find(h => h.toLowerCase().includes('timing corr'));
    const torqueCol = currentHeaders.find(h => h.toLowerCase().includes('torque at clutch (actual)')) || currentHeaders.find(h => h.toLowerCase().includes('torque') || h.toLowerCase().includes('trq'));
    const fuelCol = currentHeaders.find(h => h.toLowerCase().includes('pi fuel pressure')) || currentHeaders.find(h => h.toLowerCase().includes('low pressure fuel')) || currentHeaders.find(h => h.toLowerCase().includes('fuel pressure'));
    const speedCol = currentHeaders.find(h => h.toLowerCase().includes('speed') && !h.toLowerCase().includes('engine'));

    currentData.forEach(row => {
        // We parse and cap the values to prevent insane garbage values (like 16777216) from the ECU boostlogger
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
            // Filter common placeholder values (like 1024 or 16777216)
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

    if (boostCol && maxB !== null) valBoost.textContent = maxB.toFixed(1); else valBoost.textContent = '--';
    if (rpmCol && maxR !== null) valRpm.textContent = maxR.toFixed(0); else valRpm.textContent = '--';
    if (timingCol && maxT !== null) valTiming.textContent = maxT.toFixed(1); else valTiming.textContent = '--';
    if (torqueCol && maxTrq !== null) valTorque.textContent = maxTrq.toFixed(0); else valTorque.textContent = '--';
    if (fuelCol && maxFuel !== null) valFuelPressure.textContent = maxFuel.toFixed(1); else valFuelPressure.textContent = '--';
    if (speedCol && maxSpd !== null) valSpeed.textContent = maxSpd.toFixed(0); else valSpeed.textContent = '--';
}

function renderChart() {
    if (currentChart) {
        currentChart.destroy();
    }

    const xCol = xAxisSelect.value;
    const labels = currentData.map(row => row[xCol]);

    const datasets = [];
    const checkboxes = paramToggles.querySelectorAll('input:checked');

    // Clear all peaks in sidebar first (reset view)
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
            grid: { color: '#2A303F' },
            ticks: { color: '#8B94A5' }
        }
    };

    checkboxes.forEach((cb) => {
        const header = cb.value;
        const color = lineColors[currentHeaders.indexOf(header) % lineColors.length];

        const data = currentData.map(row => {
            const v = parseFloat(row[header]);
            return isNaN(v) ? null : v;
        });

        const lh = header.toLowerCase();
        const isHighPress = lh.includes('hpfp') || lh.includes('rail pressure') ||
                            (lh.includes('fuel pressure') && lh.includes('high')) ||
                            lh.includes('di pressure');

        let stackID = 'y-perf';
        if (lh.includes('rpm') || lh.includes('speed')) {
            stackID = 'y-engine';
        } else if (lh.includes('timing') || lh.includes('corr') || lh.includes('angle')) {
            stackID = 'y-tuning';
        } else if (isHighPress) {
            stackID = 'y-hp';
        } else if (lh.includes('afr') || lh.includes('lambda') || lh.includes('fuel') ||
                   lh.includes('stft') || lh.includes('ltft')) {
            stackID = 'y-fuel';
        }

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
            grid: isPrimary ? { color: '#2A303F' } : { drawOnChartArea: false },
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
            backgroundColor: `${color}1A`,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.2,
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

    currentChart = new Chart(ctx, {
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
                    backgroundColor: 'rgba(24, 28, 37, 0.95)',
                    titleColor: '#3A86FF',
                    padding: 12,
                    borderColor: '#2A303F',
                    borderWidth: 1,
                    bodySpacing: 4
                },
                decimation: { enabled: true, algorithm: 'lttb', samples: 500 }
            },
            scales: scalesConfig
        }
    });
}

function uploadToBackend(file) {
    const formData = new FormData();
    formData.append('file', file);

    fetch('/api/upload', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
    })
        .then(r => r.json())
        .then(data => {
            setDownloadLink(data.url, data.filename);
            refreshLogList(data.id);
            if (data.duplicate) {
                setTimeout(() => showToast('Log already exists — loaded from your library.', 'info'), 300);
            }
        })
        .catch(err => console.error('Upload to backend failed:', err));
}

function setDownloadLink(url, filename) {
    if (url) currentServerFile = url.split('/').pop();
    const btnDownload = document.getElementById('btnDownload');
    if (btnDownload && url) {
        btnDownload.href = url;
        btnDownload.download = filename || 'log.csv';
        btnDownload.style.display = 'flex';
    }

    const btnAnalyze = document.getElementById('btnAnalyze');
    const fabAi = document.getElementById('fabAi');
    const chatBox = document.getElementById('chatBox');

    // Reset to loading state while we fetch analysis history
    if (btnAnalyze) { btnAnalyze.disabled = true; btnAnalyze.innerHTML = 'Loading...'; }
    if (fabAi) fabAi.disabled = true;
    if (chatBox) chatBox.innerHTML = '<div class="msg system">Checking for prior analysis...</div>';

    if (currentServerFile) {
        loadAnalysisHistory(currentServerFile);
    }
}

function loadAnalysisHistory(filename) {
    const btnAnalyze = document.getElementById('btnAnalyze');
    const fabAi = document.getElementById('fabAi');
    const chatBox = document.getElementById('chatBox');
    const historySection = document.getElementById('analysisHistory');
    const historyPills = document.getElementById('historyPills');
    const historyCount = document.getElementById('historyCount');

    fetch(`/api/analyses/${filename}`, { headers: getAuthHeaders() })
        .then(res => res.json())
        .then(data => {
            const analyses = data.analyses || [];

            if (analyses.length === 0) {
                // No prior analyses
                historySection.style.display = 'none';
                chatBox.innerHTML = '<div class="msg system">Ready for AI Analysis. Click the turbo button to begin.</div>';
                if (btnAnalyze) { btnAnalyze.disabled = analysisRunning; btnAnalyze.innerHTML = 'Start Analysis'; btnAnalyze.classList.remove('btn-rerun'); }
                if (fabAi) fabAi.disabled = false;
                return;
            }

            // Build history pills
            historySection.style.display = 'block';
            historyCount.textContent = `${analyses.length} run${analyses.length > 1 ? 's' : ''}`;
            historyPills.innerHTML = '';

            analyses.forEach((a, i) => {
                const pill = document.createElement('button');
                pill.className = 'history-pill' + (i === 0 ? ' active' : '');
                const d = new Date(a.created_at);
                pill.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                pill.title = `Model: ${a.model_used}`;
                pill.onclick = () => {
                    document.querySelectorAll('.history-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                    renderAnalysisContent(a);
                };
                historyPills.appendChild(pill);
            });

            // Show most recent analysis by default
            renderAnalysisContent(analyses[0]);
            if (btnAnalyze) { btnAnalyze.disabled = analysisRunning; btnAnalyze.innerHTML = 'Re-run Analysis'; btnAnalyze.classList.add('btn-rerun'); }
            if (fabAi) fabAi.disabled = false;

            // Auto-open drawer to show cached result - REMOVED per user request
            // if (!document.getElementById('aiDrawer').classList.contains('open')) {
            //     toggleAiDrawer();
            // }
        })
        .catch(() => {
            historySection.style.display = 'none';
            chatBox.innerHTML = '<div class="msg system">Ready for AI Analysis. Click the turbo button to begin.</div>';
            if (btnAnalyze) { btnAnalyze.disabled = analysisRunning; btnAnalyze.innerHTML = 'Start Analysis'; btnAnalyze.classList.remove('btn-rerun'); }
            if (fabAi) fabAi.disabled = false;
        });
}

function renderAnalysisContent(analysis) {
    const chatBox = document.getElementById('chatBox');
    const when = new Date(analysis.created_at).toLocaleString();
    chatBox.innerHTML = `
        <div class="msg system" style="margin-bottom: 8px; font-size: 11px;">📋 Analysis from ${when} &nbsp;·&nbsp; <span style="opacity:0.6;">${analysis.model_used}</span></div>
        <div class="markdown-body" style="padding: 10px; font-size: 14px; text-align: left; color: var(--text-primary);">${marked.parse(analysis.result_markdown)}</div>
    `;
}

async function triggerAnalysis() {
    if (!currentServerFile || analysisRunning) return;

    analysisRunning = true;
    const analysisFile = currentServerFile;
    analysisRunningFile = analysisFile;
    analysisRunningName = document.getElementById('pageTitle')?.textContent || analysisFile;
    document.querySelector('#logItems li.active-log')?.classList.add('analyzing-log');
    const btn = document.getElementById('btnAnalyze');
    const chatBox = document.getElementById('chatBox');

    const fabAi = document.getElementById('fabAi');
    btn.disabled = true;
    btn.innerHTML = 'Analyzing...';
    fabAi?.classList.add('analyzing');
    chatBox.innerHTML = `
        <div class="ai-thinking">
            <div class="ai-thinking-header">
                <span class="ai-thinking-label">Agent is analysing telemetry</span>
            </div>
            <div class="ai-thinking-dots">
                <span></span><span></span><span></span>
            </div>
            <div class="ai-thinking-steps" id="thinkingSteps"></div>
        </div>
    `;

    // Cycle through status messages to show progress
    const steps = [
        'Reading datalog headers...',
        'Scanning boost trace...',
        'Checking ignition timing...',
        'Evaluating fueling data...',
        'Cross-referencing ECU parameters...',
        'Building tuning report...',
    ];
    const stepsEl = document.getElementById('thinkingSteps');
    let stepIndex = 0;
    const stepInterval = setInterval(() => {
        if (!stepsEl) return clearInterval(stepInterval);
        if (stepIndex < steps.length) {
            const line = document.createElement('div');
            line.className = 'thinking-step';
            line.textContent = steps[stepIndex++];
            stepsEl.appendChild(line);
            stepsEl.scrollTop = stepsEl.scrollHeight;
        }
    }, 1800);

    try {
        const res = await fetch(`/api/analyze/${analysisFile}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await res.json();

        if (res.status === 429) throw new Error('Analysis already in progress — please wait for it to finish.');
        if (!res.ok) throw new Error(data.detail || 'Analysis failed');

        clearInterval(stepInterval);
        analysisRunning = false;
        analysisRunningFile = null;
        analysisRunningName = null;
        document.querySelector('#logItems li.analyzing-log')?.classList.remove('analyzing-log');
        fabAi?.classList.remove('analyzing');
        if (analysisFile === currentServerFile) loadAnalysisHistory(currentServerFile);
        refreshLogList();
        if (!document.getElementById('aiDrawer').classList.contains('open')) {
            toggleAiDrawer();
        }
    } catch (err) {
        clearInterval(stepInterval);
        analysisRunning = false;
        analysisRunningFile = null;
        analysisRunningName = null;
        document.querySelector('#logItems li.analyzing-log')?.classList.remove('analyzing-log');
        fabAi?.classList.remove('analyzing');
        chatBox.innerHTML = `<div class="msg" style="color: var(--danger);">Error: ${err.message}</div>`;
        btn.disabled = false;
        btn.innerHTML = 'Retry Analysis';
    }
}

function refreshLogList(selectId = null) {
    fetch('/api/logs', { headers: getAuthHeaders() })
        .then(res => res.json())
        .then(async data => {
            if (!data.logs || data.logs.length === 0) return;
            logItems.innerHTML = '';

            for (const log of data.logs) {
                // Task 4: Check if this log has a cached analysis
                let hasAnalysis = false;
                try {
                    const storedFilename = log.url.split('/').pop();
                    const r = await fetch(`/api/analyze/${storedFilename}`, { headers: getAuthHeaders() });
                    const d = await r.json();
                    hasAnalysis = Boolean(d.analysis);
                } catch (_) { }

                // Task 2: Format the uploaded_at timestamp
                let timeLabel = '';
                if (log.uploaded_at) {
                    const d = new Date(log.uploaded_at);
                    timeLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                        + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                }

                const li = document.createElement('li');
                if (currentLogId && log.id === currentLogId) {
                    li.classList.add('active-log');
                }
                li.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                        <span style="display:flex; align-items:center; gap:6px; overflow:hidden; flex: 1;">
                            <span>📊</span>
                            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${log.name}</span>
                        </span>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <button class="rename-log-btn" title="Rename Log">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                            </button>
                            ${hasAnalysis ? '<span class="analysis-badge" title="Has prior analysis">✦ AI</span>' : ''}
                        </div>
                    </div>
                    ${timeLabel ? `<div class="log-timestamp">${timeLabel}</div>` : ''}
                `;

                const renameBtn = li.querySelector('.rename-log-btn');
                renameBtn.onclick = (e) => {
                    e.stopPropagation();
                    renameLog(log.id, log.name);
                };
                li.onclick = () => loadServerLog(log, li);
                logItems.appendChild(li);

                if (selectId && log.id === selectId) {
                    setActiveLog(log.id, log.name, li);
                }
            }
        })
        .catch(err => console.error('Error fetching logs:', err));
}

function loadServerLog(log, listItem = null) {
    const logFilename = log.url.split('/').pop();
    if (analysisRunning && analysisRunningFile !== logFilename) {
        showToast(`Analysis in progress on "${analysisRunningName}" — please wait`, 'info');
        return;
    }
    setActiveLog(log.id, log.name, listItem);

    fetch(log.url, { headers: getAuthHeaders() })
        .then(res => res.text())
        .then(csvText => {
            Papa.parse(csvText, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: function (results) {
                    currentData = results.data;
                    currentHeaders = results.meta.fields;
                    processDataForGraph();
                    setDownloadLink(log.url, log.name);
                }
            });
        })
        .catch(err => console.error('Error loading historic log:', err));
} async function renameLog(logId, currentName) {
    currentRenameId = logId;
    const modal = document.getElementById('renameModal');
    const input = document.getElementById('renameInput');
    if (modal && input) {
        input.value = currentName;
        modal.style.display = 'flex';
        input.focus();
        input.select();
    }
}

function closeRenameModal() {
    const modal = document.getElementById('renameModal');
    if (modal) modal.style.display = 'none';
}

async function submitRename() {
    const input = document.getElementById('renameInput');
    const newName = input ? input.value.trim() : '';
    const logId = currentRenameId;

    if (!newName || !logId) return;

    closeRenameModal();

    try {
        const res = await fetch(`/api/logs/${logId}/rename`, {
            method: 'PUT',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ new_name: newName })
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.detail || 'Failed to rename log');
        }

        // Optimistic / Immediate UI update for "Syncing Divs"
        if (currentLogId === logId) {
            const title = document.getElementById('pageTitle');
            if (title) title.textContent = newName;
        }

        showToast('Log renamed successfully');
        refreshLogList(); // This will sync the sidebar and any other views
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function toggleAllParams(checked) {
    const checkboxes = document.querySelectorAll('#paramToggles input[type="checkbox"]');
    checkboxes.forEach(cb => {
        const lbl = cb.parentElement;
        // Only toggle if the label is visible (not hidden by filter)
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


function openUploadModal() {
    document.getElementById('uploadModal').style.display = 'flex';
    document.getElementById('urlImportModalHint').textContent = '';
    document.getElementById('urlImportModalHint').style.color = '';
}

function closeUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
    document.getElementById('urlImportModalInput').value = '';
    document.getElementById('urlImportModalHint').textContent = '';
}

function closeUrlImportModal() { closeUploadModal(); }

async function submitUrlImportModal() {
    const input = document.getElementById('urlImportModalInput');
    const hint = document.getElementById('urlImportModalHint');
    await importFromUrl(input.value.trim(), hint, () => closeUploadModal());
}

async function importFromUrl(url, hint, onSuccess) {
    if (!url) return;

    let fetchUrl = url;
    if (url.includes('bootmod3.net/log')) {
        fetchUrl = url.replace('bootmod3.net/log', 'bootmod3.net/dlog');
    }

    hint.style.color = 'var(--text-secondary)';
    hint.textContent = fetchUrl !== url ? 'Detected bootmod3 link, fetching CSV…' : 'Fetching…';

    try {
        const isBootmod3 = fetchUrl.includes('bootmod3.net');
        const proxyFetchUrl = isBootmod3
            ? `/api/proxy-csv?url=${encodeURIComponent(fetchUrl)}`
            : fetchUrl;

        const res = await fetch(proxyFetchUrl, { headers: isBootmod3 ? getAuthHeaders() : {} });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `Server returned ${res.status}`);
        }
        const text = await res.text();

        if (!text.includes(',') || !text.includes('\n')) {
            throw new Error('URL does not appear to be a CSV file.');
        }

        const idMatch = fetchUrl.match(/[?&]id=([^&]+)/);
        const filename = idMatch ? `dlog_${idMatch[1]}.csv` : (fetchUrl.split('/').pop().split('?')[0] || 'imported.csv');
        const file = new File([text], filename.endsWith('.csv') ? filename : filename + '.csv', { type: 'text/csv' });
        hint.textContent = '';
        onSuccess?.();
        handleFile(file);
    } catch (err) {
        hint.style.color = 'var(--danger)';
        hint.textContent = `Failed: ${err.message}`;
    }
}

async function handleUrlImport() {
    const input = document.getElementById('urlImportInput');
    const hint = document.getElementById('urlImportHint');
    await importFromUrl(input.value.trim(), hint, () => { input.value = ''; });
}

function toggleFocusMode() {
    const isFocus = document.body.classList.toggle('focus-mode');
    const btn = document.getElementById('btnFocusMode');
    if (btn) {
        btn.querySelector('.icon-expand').style.display = isFocus ? 'none' : '';
        btn.querySelector('.icon-compress').style.display = isFocus ? '' : 'none';
        btn.querySelector('span').textContent = isFocus ? 'Exit' : 'Focus';
    }
    setTimeout(() => {
        if (currentChart) currentChart.resize();
    }, 300);
}
