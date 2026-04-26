let authToken = localStorage.getItem('boostlog_token') || null;
let authMode = 'login';
let currentServerFile = null;
let currentLogId = null;
let currentRenameId = null;
let currentProjects = [];
let currentLogs = [];
let hasAnalysisById = new Map();
let currentView = 'dashboard'; // 'dashboard' | 'library'
let libraryFilter = 'all'; // 'all' | 'unassigned' | <project_id>
let bulkSelection = new Set();
const SIDEBAR_LOG_LIMIT = 5;

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
    // Enable/disable AI FAB
    const fab = document.getElementById('fabAi');
    if (fab) {
        fab.disabled = !id && !currentData;
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
        startPasskeyAutofill();
    }
}

let _autofillStarted = false;

async function startPasskeyAutofill() {
    if (_autofillStarted) return;
    if (!window.SimpleWebAuthnBrowser) return;
    try {
        const supported = await SimpleWebAuthnBrowser.browserSupportsWebAuthnAutofill?.();
        if (!supported) return;
    } catch { return; }
    _autofillStarted = true;
    try {
        const optsRes = await fetch('/api/auth/webauthn/login/discoverable/options');
        if (!optsRes.ok) return;
        const optionsJSON = await optsRes.json();

        const asseResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON, useBrowserAutofill: true });

        const verifyRes = await fetch('/api/auth/webauthn/login/discoverable/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(asseResp)
        });
        const data = await verifyRes.json();
        if (verifyRes.ok && data.access_token) {
            authToken = data.access_token;
            localStorage.setItem('boostlog_token', authToken);
            location.reload();
        } else if (verifyRes.ok === false) {
            console.warn('Passkey autofill verify failed:', data.detail);
        }
    } catch (err) {
        // User cancelled, no passkey selected, or browser aborted — silent fallback.
        console.debug('Passkey autofill ended:', err && err.message);
        _autofillStarted = false;
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

async function loginAsDemo() {
    const errorEl = document.getElementById('authError');
    if (errorEl) errorEl.textContent = '';
    try {
        await performLogin('demo', 'demo');
    } catch (err) {
        if (errorEl) errorEl.textContent = "Demo mode failed: " + err.message;
    }
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

// Legacy file input — kept for e2e test compat
if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });
}

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

    // Enable AI FAB if data is present
    const fab = document.getElementById('fabAi');
    if (fab) {
        fab.disabled = !currentData;
    }

    // Auto-hide sidebar to focus on the chart
    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.classList.contains('collapsed')) {
        sidebar.classList.add('collapsed');
    }
    // Mobile: close the sidebar overlay if open
    const sidebarEl = document.querySelector('.sidebar');
    if (sidebarEl && sidebarEl.classList.contains('open') && window.innerWidth <= 768) {
        toggleSidebar();
    }

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
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: { color: 'rgba(255, 255, 255, 0.3)', maxTicksLimit: 12 }
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
            tension: 0.4, // Smoother splines like the landing page
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

async function refreshLogList(selectId = null) {
    try {
        const [logsRes, projectsRes] = await Promise.all([
            fetch('/api/logs', { headers: getAuthHeaders() }),
            fetch('/api/projects', { headers: getAuthHeaders() })
        ]);
        currentLogs = (await logsRes.json()).logs || [];
        currentProjects = (await projectsRes.json()).projects || [];

        // Resolve "has prior analysis" once for all logs (used by both sidebar and library)
        const analyses = await Promise.all(currentLogs.map(async (log) => {
            try {
                const stored = log.url.split('/').pop();
                const r = await fetch(`/api/analyze/${stored}`, { headers: getAuthHeaders() });
                return [log.id, Boolean((await r.json()).analysis)];
            } catch { return [log.id, false]; }
        }));
        hasAnalysisById = new Map(analyses);

        renderSidebarLogs(selectId);
        if (currentView === 'library') renderLibrary();
        if (currentView === 'projects') renderProjectsView();
    } catch (err) {
        console.error('Error fetching logs/projects:', err);
    }
}

function renderSidebarLogs(selectId = null) {
    logItems.innerHTML = '';

    if (currentLogs.length === 0) {
        logItems.innerHTML = '<li class="empty-state">No logs uploaded yet</li>';
        return;
    }

    const recent = currentLogs.slice(0, SIDEBAR_LOG_LIMIT);
    for (const log of recent) renderLogItem(log, hasAnalysisById.get(log.id), selectId);

    if (currentLogs.length > SIDEBAR_LOG_LIMIT) {
        const more = document.createElement('li');
        more.className = 'view-all-link';
        more.innerHTML = `View all ${currentLogs.length} in Library <span aria-hidden="true">→</span>`;
        more.onclick = () => switchView('library');
        logItems.appendChild(more);
    }
}

function renderLogItem(log, hasAnalysis, selectId) {
    let timeLabel = '';
    if (log.uploaded_at) {
        const d = new Date(log.uploaded_at);
        timeLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    const li = document.createElement('li');
    if (currentLogId && log.id === currentLogId) li.classList.add('active-log');
    
    // Find build for pill
    const proj = log.project_id != null ? currentProjects.find(p => p.id === log.project_id) : null;

    li.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <span style="display:flex; align-items:center; gap:6px; overflow:hidden; flex: 1;">
                <span>📊</span>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${log.name}</span>
            </span>
            <div style="display:flex; align-items:center; gap:4px;">
                <button class="rename-log-btn" title="Rename Log">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                ${hasAnalysis ? '<span class="analysis-badge" title="Has prior analysis">✦ AI</span>' : ''}
            </div>
        </div>
        <div class="sidebar-log-footer">
            ${timeLabel ? `<div class="log-timestamp">${timeLabel}</div>` : '<div></div>'}
            ${proj ? `<div class="sidebar-build-pill">${proj.name}</div>` : ''}
        </div>
    `;

    li.querySelector('.rename-log-btn').onclick = (e) => {
        e.stopPropagation();
        renameLog(log.id, log.name);
    };
    li.onclick = () => loadServerLog(log, li);
    logItems.appendChild(li);

    if (selectId && log.id === selectId) setActiveLog(log.id, log.name, li);
}

// === Project CRUD ===
async function createProject(payload) {
    const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to create build');
    return data;
}

async function renameProject(id, name) {
    const res = await fetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to rename build');
    return data;
}

async function deleteProject(id) {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to delete build');
    }
}

async function moveLogToProject(logId, projectId) {
    const res = await fetch(`/api/logs/${logId}/project`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to move log');
    return data;
}

let pendingProjectCallback = null;

function newProjectPrompt() {
    openNewProjectModal();
}

function openNewProjectModal(onCreate = null) {
    pendingProjectCallback = onCreate;
    const modal = document.getElementById('newProjectModal');
    if (modal) {
        document.getElementById('newProjectInput').value = '';
        document.getElementById('newProjectVin').value = '';
        document.getElementById('newProjectVehicle').value = '';
        document.getElementById('newProjectCustomer').value = '';
        document.getElementById('newProjectNotes').value = '';
        document.getElementById('newProjectStatus').value = '';
        modal.style.display = 'flex';
        setTimeout(() => document.getElementById('newProjectInput').focus(), 50);
    }
}

function closeNewProjectModal() {
    const modal = document.getElementById('newProjectModal');
    if (modal) modal.style.display = 'none';
    pendingProjectCallback = null;
}

async function submitNewProject() {
    const name = document.getElementById('newProjectInput').value.trim();
    if (!name) {
        showToast('Build name is required', 'error');
        return;
    }

    const payload = {
        name: name,
        vin: document.getElementById('newProjectVin').value.trim(),
        vehicle_model: document.getElementById('newProjectVehicle').value.trim(),
        customer_name: document.getElementById('newProjectCustomer').value.trim(),
        notes: document.getElementById('newProjectNotes').value.trim(),
        status: document.getElementById('newProjectStatus').value || null
    };

    const cb = pendingProjectCallback;
    closeNewProjectModal();
    try {
        const proj = await createProject(payload);
        showToast('Build created');
        if (cb) await cb(proj);
        await refreshLogList();
    } catch (err) { showToast(err.message, 'error'); }
}

// === Project picker popover (move log → project) ===
function closeProjectPicker() {
    document.getElementById('projectPicker')?.remove();
}

function showProjectPicker(buttonEl, logId, currentProjectId) {
    closeProjectPicker();

    const picker = document.createElement('div');
    picker.className = 'project-picker';
    picker.id = 'projectPicker';

    const opts = [
        { id: null, name: 'Unassigned' },
        ...currentProjects,
        { id: '__new__', name: '+ New build…' }
    ];

    opts.forEach(opt => {
        const item = document.createElement('button');
        item.className = 'project-picker-item';
        if (opt.id === currentProjectId) item.classList.add('active');
        item.textContent = opt.name;
        item.onclick = async (e) => {
            e.stopPropagation();
            closeProjectPicker();
            try {
                if (opt.id === '__new__') {
                    openNewProjectModal(async (proj) => {
                        await moveLogToProject(logId, proj.id);
                        showToast('Log moved');
                    });
                    return;
                }
                await moveLogToProject(logId, opt.id);
                showToast('Log moved');
                refreshLogList();
            } catch (err) { showToast(err.message, 'error'); }
        };
        picker.appendChild(item);
    });

    document.body.appendChild(picker);
    const rect = buttonEl.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();
    picker.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - pickerRect.height - 8)}px`;
    picker.style.left = `${Math.max(8, rect.right - pickerRect.width)}px`;

    setTimeout(() => {
        const dismiss = (ev) => {
            if (!picker.contains(ev.target)) closeProjectPicker();
            else document.addEventListener('click', dismiss, { once: true });
        };
        document.addEventListener('click', dismiss, { once: true });
    }, 0);
}

function loadServerLog(log, listItem = null) {
    const logFilename = log.url.split('/').pop();
    if (analysisRunning && analysisRunningFile !== logFilename) {
        showToast(`Analysis in progress on "${analysisRunningName}" — please wait`, 'info');
        return;
    }
    setActiveLog(log.id, log.name, listItem);

    // Switch to dashboard so the graph is visible
    if (currentView !== 'dashboard') {
        switchView('dashboard');
    }

    // Close mobile sidebar if open
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        document.getElementById('sidebarOverlay')?.classList.remove('open');
    }

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
}

let _renameOnSave = null;

function openRenameModal({ title = 'Rename', label = '', placeholder = '', currentName = '', confirmText = 'Save Changes', onSave }) {
    const modal = document.getElementById('renameModal');
    const titleEl = document.getElementById('renameModalTitle');
    const labelEl = document.getElementById('renameModalLabel');
    const confirmBtn = document.getElementById('renameModalConfirm');
    const input = document.getElementById('renameInput');
    if (!modal || !input) return;

    titleEl.textContent = title;
    labelEl.textContent = label;
    labelEl.style.display = label ? 'block' : 'none';
    if (confirmBtn) confirmBtn.textContent = confirmText;
    input.placeholder = placeholder;
    input.value = currentName;
    _renameOnSave = onSave;

    modal.style.display = 'flex';
    setTimeout(() => { input.focus(); input.select(); }, 0);
}

async function renameLog(logId, currentName) {
    openRenameModal({
        title: 'Rename Log',
        label: 'Enter a new descriptive name for your datalog.',
        placeholder: 'Log Name',
        currentName,
        onSave: (newName) => submitLogRename(logId, newName)
    });
}

function closeRenameModal() {
    const modal = document.getElementById('renameModal');
    if (modal) modal.style.display = 'none';
    _renameOnSave = null;
}

async function submitRename() {
    const input = document.getElementById('renameInput');
    const newName = input ? input.value.trim() : '';
    if (!newName || !_renameOnSave) return;

    const handler = _renameOnSave;
    closeRenameModal();
    try {
        await handler(newName);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function submitLogRename(logId, newName) {
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

// === View switcher (Dashboard <-> Library) ===
function switchView(view) {
    currentView = view;
    document.body.classList.toggle('view-library', view === 'library');
    document.body.classList.toggle('view-settings', view === 'settings');

    document.querySelectorAll('[data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });

    const views = ['dashboard', 'libraryView', 'settingsView', 'projectsView'];
    
    // Toggle actual element visibility
    if (view === 'dashboard') {
        document.querySelector('.dashboard-grid').style.display = 'grid';
        document.getElementById('libraryView').style.display = 'none';
        document.getElementById('projectsView').style.display = 'none';
        document.getElementById('settingsView').style.display = 'none';
        setTimeout(() => { if (currentChart) currentChart.resize(); }, 50);
    } else if (view === 'library') {
        document.querySelector('.dashboard-grid').style.display = 'none';
        document.getElementById('libraryView').style.display = 'block';
        document.getElementById('projectsView').style.display = 'none';
        document.getElementById('settingsView').style.display = 'none';
        renderLibrary();
    } else if (view === 'projects') {
        document.querySelector('.dashboard-grid').style.display = 'none';
        document.getElementById('libraryView').style.display = 'none';
        document.getElementById('projectsView').style.display = 'block';
        document.getElementById('settingsView').style.display = 'none';
        renderProjectsView();
    } else if (view === 'settings') {
        document.querySelector('.dashboard-grid').style.display = 'none';
        document.getElementById('libraryView').style.display = 'none';
        document.getElementById('projectsView').style.display = 'none';
        document.getElementById('settingsView').style.display = 'block';
        loadUserSettings();
    }
}

// === Library View ===
function renderLibrary() {
    renderLibraryRail();
    renderLibraryLogs();
}

function renderLibraryRail() {
    const smart = document.getElementById('railSmart');
    const projects = document.getElementById('railProjects');
    if (!smart || !projects) return;

    const unassignedCount = currentLogs.filter(l => l.project_id == null).length;

    const smartItems = [
        { key: 'all', name: 'All Logs', count: currentLogs.length, icon: 'all' },
        { key: 'unassigned', name: 'Unassigned', count: unassignedCount, icon: 'unassigned' },
    ];

    smart.innerHTML = '';
    for (const item of smartItems) {
        smart.appendChild(buildRailItem(item.key, item.name, item.count, false));
    }

    projects.innerHTML = '';
    if (currentProjects.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'rail-empty';
        empty.textContent = 'No projects yet';
        projects.appendChild(empty);
    } else {
        for (const p of currentProjects) {
            const count = currentLogs.filter(l => l.project_id === p.id).length;
            projects.appendChild(buildRailItem(p.id, p.name, count, true));
        }
    }
}

function buildRailItem(key, name, count, withActions) {
    const li = document.createElement('li');
    li.className = 'rail-item' + (String(libraryFilter) === String(key) ? ' active' : '');
    li.innerHTML = `
        <span class="rail-item-name">${name}</span>
        <span class="rail-item-count">${count}</span>
        ${withActions ? `
            <div class="rail-item-actions">
                <button class="rail-rename" title="Rename">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                <button class="rail-delete" title="Delete project">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path>
                    </svg>
                </button>
            </div>` : ''}
    `;
    li.addEventListener('click', () => {
        libraryFilter = key;
        clearBulkSelection();
        renderLibrary();
    });
    if (withActions) {
        li.querySelector('.rail-rename').onclick = async (e) => {
            e.stopPropagation();
            const next = prompt('Rename project:', name);
            if (!next || next.trim() === name) return;
            try {
                await renameProject(key, next.trim());
                showToast('Build renamed');
                refreshLogList();
            } catch (err) { showToast(err.message, 'error'); }
        };
        li.querySelector('.rail-delete').onclick = async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete project "${name}"? Logs will move back to Unassigned.`)) return;
            try {
                await deleteProject(key);
                if (libraryFilter === key) libraryFilter = 'all';
                showToast('Build deleted');
                refreshLogList();
            } catch (err) { showToast(err.message, 'error'); }
        };
    }
    return li;
}

function getFilteredLibraryLogs() {
    let logs = currentLogs.slice();
    if (libraryFilter === 'all') {
        // no-op
    } else if (libraryFilter === 'unassigned') {
        logs = logs.filter(l => l.project_id == null);
    } else {
        logs = logs.filter(l => String(l.project_id) === String(libraryFilter));
    }

    const q = (document.getElementById('librarySearch')?.value || '').toLowerCase().trim();
    if (q) logs = logs.filter(l => l.name.toLowerCase().includes(q));

    const sort = document.getElementById('librarySort')?.value || 'newest';
    if (sort === 'newest') {
        logs.sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
    } else if (sort === 'oldest') {
        logs.sort((a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at));
    } else if (sort === 'name') {
        logs.sort((a, b) => a.name.localeCompare(b.name));
    }
    return logs;
}

function renderLibraryLogs() {
    const grid = document.getElementById('libraryGrid');
    const empty = document.getElementById('libraryEmpty');
    const title = document.getElementById('libraryActiveTitle');
    const countPill = document.getElementById('libraryActiveCount');
    if (!grid) return;

    // Title reflects the active filter
    if (libraryFilter === 'all') title.textContent = 'All Logs';
    else if (libraryFilter === 'unassigned') title.textContent = 'Unassigned';
    else {
        const proj = currentProjects.find(p => p.id === libraryFilter);
        title.textContent = proj ? proj.name : 'Build';
    }

    const logs = getFilteredLibraryLogs();
    countPill.textContent = logs.length;

    // Show/hide project details button
    const btnDetails = document.getElementById('btnProjectDetails');
    if (btnDetails) {
        btnDetails.style.display = (libraryFilter !== 'all' && libraryFilter !== 'unassigned') ? 'flex' : 'none';
    }

    grid.innerHTML = '';
    if (logs.length === 0) {
        empty.style.display = 'block';
        empty.querySelector('p').textContent =
            currentLogs.length === 0 ? 'No logs uploaded yet. Click "Upload Boostlog" in the sidebar to get started.' :
            'No logs match your filter.';
        return;
    }
    empty.style.display = 'none';

    for (const log of logs) {
        grid.appendChild(buildLogCard(log));
    }
    refreshBulkBar();
}

function buildLogCard(log) {
    const card = document.createElement('article');
    card.className = 'log-card' + (bulkSelection.has(log.id) ? ' selected' : '');
    const proj = log.project_id != null ? currentProjects.find(p => p.id === log.project_id) : null;
    const hasAi = hasAnalysisById.get(log.id);
    let timeLabel = '';
    if (log.uploaded_at) {
        const d = new Date(log.uploaded_at);
        timeLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    card.innerHTML = `
        <label class="log-card-check" title="Select">
            <input type="checkbox" ${bulkSelection.has(log.id) ? 'checked' : ''}>
        </label>
        <div class="log-card-body">
            <div class="log-card-title">
                <span class="log-card-icon">📊</span>
                <span class="log-card-name" title="${log.name}">${log.name}</span>
            </div>
            <div class="log-card-meta">
                ${proj ? `<span class="log-card-project">${proj.name}</span>` : '<span class="log-card-project muted">Unassigned</span>'}
                ${hasAi ? '<span class="analysis-badge">✦ AI</span>' : ''}
                ${timeLabel ? `<span class="log-card-time">${timeLabel}</span>` : ''}
            </div>
        </div>
        <div class="log-card-actions">
            <button class="log-card-btn" data-action="open" title="Analyze in Dyno">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 12 7 12 10 4 14 20 17 12 21 12"></polyline>
                </svg>
            </button>
            <button class="log-card-btn" data-action="move" title="Move to build">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
            </button>
            <button class="log-card-btn" data-action="rename" title="Rename">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
        </div>
    `;

    const checkbox = card.querySelector('.log-card-check input');
    checkbox.onchange = (e) => {
        if (e.target.checked) bulkSelection.add(log.id);
        else bulkSelection.delete(log.id);
        card.classList.toggle('selected', e.target.checked);
        refreshBulkBar();
    };
    card.querySelector('.log-card-check').onclick = (e) => e.stopPropagation();

    card.querySelector('[data-action="open"]').onclick = (e) => {
        e.stopPropagation();
        openLogFromLibrary(log);
    };
    card.querySelector('[data-action="move"]').onclick = (e) => {
        e.stopPropagation();
        showProjectPicker(e.currentTarget, log.id, log.project_id);
    };
    card.querySelector('[data-action="rename"]').onclick = (e) => {
        e.stopPropagation();
        renameLog(log.id, log.name);
    };
    // Card body click also opens
    card.querySelector('.log-card-body').onclick = () => openLogFromLibrary(log);

    return card;
}

function openLogFromLibrary(log) {
    switchView('dashboard');
    loadServerLog(log);
}

function refreshBulkBar() {
    const bar = document.getElementById('libraryBulkBar');
    const count = document.getElementById('libraryBulkCount');
    if (!bar) return;
    if (bulkSelection.size === 0) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = 'flex';
    count.textContent = `${bulkSelection.size} selected`;
}

function clearBulkSelection() {
    bulkSelection.clear();
    refreshBulkBar();
    if (currentView === 'library') renderLibraryLogs();
}

function openMoveLogsModal() {
    if (bulkSelection.size === 0) return;
    const modal = document.getElementById('moveLogsModal');
    const select = document.getElementById('moveBuildSelect');
    const context = document.getElementById('moveLogsContext');
    
    if (!modal || !select) return;

    // Populate select
    select.innerHTML = '<option value="unassigned">Unassigned (None)</option>';
    currentProjects.forEach(p => {
        select.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });
    select.innerHTML += `<option value="new">+ Create New Build...</option>`;

    context.textContent = `Moving ${bulkSelection.size} selected log(s)`;
    modal.style.display = 'flex';
}

function closeMoveLogsModal() {
    document.getElementById('moveLogsModal').style.display = 'none';
}

async function submitMoveLogs() {
    const val = document.getElementById('moveBuildSelect').value;
    const idsToMove = [...bulkSelection];
    
    closeMoveLogsModal();

    if (val === 'new') {
        openNewProjectModal(async (proj) => {
            await Promise.all(idsToMove.map(id => moveLogToProject(id, proj.id)));
            showToast(`Moved ${idsToMove.length} log(s) to ${proj.name}`);
            bulkSelection.clear();
            await refreshLogList();
        });
        return;
    }

    const targetId = val === 'unassigned' ? null : parseInt(val, 10);
    try {
        await Promise.all(idsToMove.map(id => moveLogToProject(id, targetId)));
        const targetName = targetId === null ? 'Unassigned' : currentProjects.find(p => p.id === targetId)?.name || 'Build';
        showToast(`Moved ${idsToMove.length} log(s) to ${targetName}`);
        bulkSelection.clear();
        await refreshLogList();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function bulkMovePrompt() {
    openMoveLogsModal();
}
async function loadUserSettings() {
    try {
        const res = await fetch('/api/user/me', { headers: getAuthHeaders() });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('setFullName').value = data.full_name || '';
            document.getElementById('setEmail').value = data.email || '';
            if (data.settings) {
                document.getElementById('setUnits').value = data.settings.units || 'metric';
                document.getElementById('setGraphMode').value = data.settings.graph_mode || 'single';
            }
        }
    } catch (err) { console.error('Failed to load settings:', err); }
    loadPasskeys();
}

async function loadPasskeys() {
    const list = document.getElementById('passkeyList');
    if (!list) return;
    try {
        const res = await fetch('/api/auth/passkeys', { headers: getAuthHeaders() });
        const items = await res.json();
        if (!res.ok || !Array.isArray(items)) {
            list.innerHTML = '';
            return;
        }
        if (items.length === 0) {
            list.innerHTML = '<div style="color: var(--text-secondary); font-style: italic;">No passkeys registered yet.</div>';
            return;
        }
        list.innerHTML = items.map(p => {
            const created = p.created_at ? new Date(p.created_at).toLocaleDateString() : '';
            const transports = (p.transports || []).join(', ');
            const meta = [created, transports].filter(Boolean).join(' • ');
            const safeName = escapeHtml(p.name).replace(/'/g, "\\'");
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;">
                    <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
                        <span style="font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis;">🔑 ${escapeHtml(p.name)}</span>
                        ${meta ? `<span style="color: var(--text-secondary); font-size: 11px;">${escapeHtml(meta)}</span>` : ''}
                    </div>
                    <div style="display: flex; gap: 6px;">
                        <button class="btn-secondary" onclick="renamePasskey(${p.id}, '${safeName}')" style="padding: 4px 10px; font-size: 11px; background: transparent; border: 1px solid rgba(255,255,255,0.15); color: var(--text-secondary);">Rename</button>
                        <button class="btn-secondary" onclick="deletePasskey(${p.id}, '${safeName}')" style="padding: 4px 10px; font-size: 11px; background: transparent; border: 1px solid rgba(255,255,255,0.15); color: var(--text-secondary);">Remove</button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Failed to load passkeys:', err);
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renamePasskey(id, currentName) {
    openRenameModal({
        title: 'Rename Passkey',
        label: 'Give this passkey a recognizable name (e.g. "MacBook Touch ID").',
        placeholder: 'Passkey name',
        currentName,
        onSave: async (newName) => {
            const res = await fetch(`/api/auth/passkeys/${id}`, {
                method: 'PATCH',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to rename passkey');
            }
            showToast('Passkey renamed');
            loadPasskeys();
        }
    });
}

function deletePasskey(id, name) {
    openConfirmDeleteModal({
        title: 'Remove Passkey',
        subtitle: 'You will no longer be able to sign in with this passkey.',
        body: `Are you sure you want to remove the passkey <strong>"${escapeHtml(name)}"</strong>?`,
        confirmText: 'Remove Passkey',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/auth/passkeys/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
                if (res.ok) {
                    showToast('Passkey removed');
                    loadPasskeys();
                } else {
                    const err = await res.json().catch(() => ({}));
                    showToast(err.detail || 'Failed to remove passkey', 'error');
                }
            } catch (err) { showToast(err.message, 'error'); }
        }
    });
}

async function saveUserSettings() {
    const payload = {
        full_name: document.getElementById('setFullName').value.trim(),
        email: document.getElementById('setEmail').value.trim(),
        settings_json: JSON.stringify({
            units: document.getElementById('setUnits').value,
            graph_mode: document.getElementById('setGraphMode').value
        })
    };
    try {
        const res = await fetch('/api/user/me', {
            method: 'PATCH',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast('Settings saved');
        } else {
            const err = await res.json();
            showToast(err.detail || 'Failed to save settings', 'error');
        }
    } catch (err) { showToast(err.message, 'error'); }
}

async function openProjectDetails() {
    if (libraryFilter === 'all' || libraryFilter === 'unassigned') return;
    try {
        const res = await fetch(`/api/projects/${libraryFilter}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('detName').value = data.name || '';
            document.getElementById('detVin').value = data.vin || '';
            document.getElementById('detVehicle').value = data.vehicle_model || '';
            document.getElementById('detCustomer').value = data.customer_name || '';
            document.getElementById('detNotes').value = data.notes || '';
            document.getElementById('detStatus').value = data.status || '';
            document.getElementById('projectDetailsModal').style.display = 'flex';
        }
    } catch (err) { showToast('Failed to load project details', 'error'); }
}

function closeProjectDetails() {
    document.getElementById('projectDetailsModal').style.display = 'none';
}

async function saveProjectDetails() {
    const payload = {
        name: document.getElementById('detName').value.trim(),
        vin: document.getElementById('detVin').value.trim(),
        vehicle_model: document.getElementById('detVehicle').value.trim(),
        customer_name: document.getElementById('detCustomer').value.trim(),
        notes: document.getElementById('detNotes').value.trim(),
        status: document.getElementById('detStatus').value || null
    };
    try {
        const res = await fetch(`/api/projects/${libraryFilter}`, {
            method: 'PATCH',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast('Build details updated');
            closeProjectDetails();
            refreshLogList();
        } else {
            const err = await res.json();
            showToast(err.detail || 'Update failed', 'error');
        }
    } catch (err) { showToast(err.message, 'error'); }
}

// === Garage (Projects Management) View ===
function timeAgo(isoStr) {
    if (!isoStr) return null;
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(isoStr).toLocaleDateString();
}

function getProjectStatus(p) {
    // Manual override takes priority
    if (p.status) {
        const map = {
            'active': { label: 'Active', cls: 'status-active' },
            'in_progress': { label: 'In Progress', cls: 'status-progress' },
            'on_hold': { label: 'On Hold', cls: 'status-hold' },
            'completed': { label: 'Completed', cls: 'status-completed' }
        };
        return map[p.status] || { label: p.status, cls: 'status-new' };
    }
    // Auto-detect from activity
    if (!p.log_count) return { label: 'New', cls: 'status-new' };
    if (!p.last_activity) return { label: 'Idle', cls: 'status-idle' };
    const diff = Date.now() - new Date(p.last_activity).getTime();
    const days = diff / (1000 * 60 * 60 * 24);
    if (days < 3) return { label: 'Active', cls: 'status-active' };
    if (days < 14) return { label: 'In Progress', cls: 'status-progress' };
    return { label: 'Completed', cls: 'status-completed' };
}

async function renderProjectsView() {
    const grid = document.getElementById('projectsGrid');
    const countLabel = document.getElementById('projectsCountLabel');
    const search = document.getElementById('projectsSearch')?.value.toLowerCase() || '';
    if (!grid) return;

    const filtered = currentProjects.filter(p => 
        p.name.toLowerCase().includes(search) || 
        (p.vin && p.vin.toLowerCase().includes(search)) ||
        (p.vehicle_model && p.vehicle_model.toLowerCase().includes(search)) ||
        (p.customer_name && p.customer_name.toLowerCase().includes(search))
    );

    if (countLabel) countLabel.textContent = `${filtered.length} Build${filtered.length !== 1 ? 's' : ''} in Garage`;

    grid.innerHTML = '';
    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="library-empty" style="grid-column: 1/-1; text-align: center; padding: 60px 20px;">
                <p style="font-size: 40px; margin-bottom: 12px;">🏁</p>
                <p style="font-size: 15px; color: var(--text-secondary);">No builds found. Click <strong>New Build</strong> to add your first vehicle.</p>
            </div>`;
        return;
    }

    filtered.forEach(p => {
        const status = getProjectStatus(p);
        const lastAgo = timeAgo(p.last_activity);
        const card = document.createElement('div');
        card.className = 'project-mgr-card';
        card.innerHTML = `
            <div class="project-mgr-header">
                <div class="project-mgr-title">
                    <h3>${p.name}</h3>
                    <span class="garage-status ${status.cls}">${status.label}</span>
                </div>
                <div class="project-mgr-actions">
                    <button onclick="editProjectFromView(${p.id})" title="Edit">✏️</button>
                    <button class="danger" onclick="deleteProjectFromView(${p.id}, '${p.name.replace(/'/g, "\\'")}')" title="Delete">🗑️</button>
                </div>
            </div>
            <div class="project-mgr-body">
                <div class="garage-stats-row">
                    <div class="garage-stat">
                        <span class="garage-stat-value">${p.log_count || 0}</span>
                        <span class="garage-stat-label">Logs</span>
                    </div>
                    <div class="garage-stat">
                        <span class="garage-stat-value">${lastAgo || '—'}</span>
                        <span class="garage-stat-label">Last Activity</span>
                    </div>
                </div>
                <div class="garage-details-row">
                    <div class="project-mgr-detail">
                        <label>Vehicle</label>
                        <span>${p.vehicle_model || '—'}</span>
                    </div>
                    <div class="project-mgr-detail">
                        <label>VIN</label>
                        <span class="vin-mono">${p.vin || '—'}</span>
                    </div>
                    <div class="project-mgr-detail">
                        <label>Customer</label>
                        <span>${p.customer_name || '—'}</span>
                    </div>
                </div>
            </div>
            <div class="project-mgr-footer">
                <button onclick="viewProjectLogs(${p.id})">Open Logs →</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function viewProjectLogs(projectId) {
    libraryFilter = projectId;
    switchView('library');
}

async function editProjectFromView(projectId) {
    libraryFilter = projectId; // Context for openProjectDetails
    openProjectDetails();
    // Wrap close modal to refresh our view on save
    const oldClose = closeProjectDetails;
    window.closeProjectDetails = () => {
        oldClose();
        renderProjectsView();
        window.closeProjectDetails = oldClose; // restore
    };
}

function openConfirmDeleteModal({ title = 'Confirm Delete', subtitle = '', body = '', confirmText = 'Permanently Delete', onConfirm }) {
    const modal = document.getElementById('deleteConfirmModal');
    const titleEl = document.getElementById('deleteModalTitle');
    const subtitleEl = document.getElementById('deleteModalSubtitle');
    const text = document.getElementById('deleteModalText');
    const btn = document.getElementById('btnConfirmDelete');

    if (!modal || !text || !btn) return;

    titleEl.textContent = title;
    subtitleEl.textContent = subtitle;
    subtitleEl.style.display = subtitle ? 'block' : 'none';
    text.innerHTML = body;
    btn.textContent = confirmText;

    btn.onclick = async () => {
        closeDeleteModal();
        if (onConfirm) await onConfirm();
    };

    modal.style.display = 'flex';
}

function openDeleteModal(id, name) {
    openConfirmDeleteModal({
        subtitle: 'Datalogs will be unassigned but NOT deleted.',
        body: `Are you sure you want to delete the build <strong>"${escapeHtml(name)}"</strong>?<br><br>All related logs will be safely preserved in the <strong>Unassigned</strong> category.`,
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/projects/${id}`, {
                    method: 'DELETE',
                    headers: getAuthHeaders()
                });
                if (res.ok) {
                    showToast('Build removed');
                    await refreshLogList();
                } else {
                    const err = await res.json();
                    showToast(err.detail || 'Delete failed', 'error');
                }
            } catch (err) { showToast(err.message, 'error'); }
        }
    });
}

function closeDeleteModal() {
    document.getElementById('deleteConfirmModal').style.display = 'none';
}

async function deleteProjectFromView(id, name) {
    openDeleteModal(id, name);
}


/* === Passkeys & Security === */

function registerPasskey() {
    const defaultName = `Passkey ${new Date().toLocaleDateString()}`;
    openRenameModal({
        title: 'Add a Passkey',
        label: 'Give this passkey a recognizable name (e.g. "MacBook Touch ID"). You\'ll be prompted to authenticate next.',
        placeholder: 'Passkey name',
        currentName: defaultName,
        confirmText: 'Continue',
        onSave: async (name) => {
            try {
                const resp = await fetch('/api/auth/webauthn/register/options', { headers: getAuthHeaders() });
                const options = await resp.json();

                const attResp = await SimpleWebAuthnBrowser.startRegistration(options);

                const verifyResp = await fetch(`/api/auth/webauthn/register/verify?name=${encodeURIComponent(name)}`, {
                    method: 'POST',
                    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify(attResp)
                });

                const data = await verifyResp.json();
                if (verifyResp.ok) {
                    showToast('Passkey registered successfully');
                    loadUserSettings();
                } else {
                    showToast(data.detail || 'Registration failed', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast(err.message, 'error');
            }
        }
    });
}

async function loginWithPasskey() {
    const username = document.getElementById('authUsername').value.trim();
    try {
        if (username) {
            await loginWithPasskeyForUser(username);
        } else {
            await loginWithDiscoverablePasskey();
        }
    } catch (err) {
        console.error(err);
        showToast(err.message, 'error');
    }
}

async function loginWithPasskeyForUser(username) {
    const resp = await fetch(`/api/auth/webauthn/login/options?username=${encodeURIComponent(username)}`);
    const responseText = await resp.text();
    let options;
    try { options = JSON.parse(responseText); }
    catch { throw new Error(`Server error (${resp.status}): ${responseText.substring(0, 100)}`); }
    if (!resp.ok) throw new Error(options.detail || 'Failed to get login options');

    const asseResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
    const verifyResp = await fetch(`/api/auth/webauthn/login/verify?username=${encodeURIComponent(username)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asseResp)
    });
    const data = await verifyResp.json();
    if (!verifyResp.ok) throw new Error(data.detail || 'Login failed');
    localStorage.setItem('boostlog_token', data.access_token);
    location.reload();
}

async function loginWithDiscoverablePasskey() {
    const optsRes = await fetch('/api/auth/webauthn/login/discoverable/options');
    if (!optsRes.ok) throw new Error('Failed to get login options');
    const optionsJSON = await optsRes.json();

    // No useBrowserAutofill -> modal account picker, no username needed.
    const asseResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON });

    const verifyRes = await fetch('/api/auth/webauthn/login/discoverable/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asseResp)
    });
    const data = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(data.detail || 'Passkey login failed');
    localStorage.setItem('boostlog_token', data.access_token);
    location.reload();
}

async function updateUsername() {
    const newUsername = document.getElementById('setNewUsername').value.trim();
    if (!newUsername) {
        showToast('Please enter a new username', 'info');
        return;
    }
    
    try {
        const res = await fetch('/api/user/change-username', {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_username: newUsername })
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('boostlog_token', data.access_token);
            showToast('Username updated successfully');
            setTimeout(() => location.reload(), 1500);
        } else {
            showToast(data.detail || 'Update failed', 'error');
        }
    } catch (err) { showToast(err.message, 'error'); }
}

function openForgotPassword() {
    document.getElementById('forgotPasswordModal').style.display = 'flex';
}

function closeForgotPassword() {
    document.getElementById('forgotPasswordModal').style.display = 'none';
}

async function submitForgotPassword() {
    const input = document.getElementById('forgotInput').value.trim();
    if (!input) return;
    
    try {
        const res = await fetch('/api/auth/reset-password/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username_or_email: input })
        });
        if (res.ok) {
            document.getElementById('forgotHint').textContent = 'Recovery check complete (see server logs in dev)';
            document.getElementById('forgotHint').style.display = 'block';
        }
    } catch (err) { showToast(err.message, 'error'); }
}

async function submitResetPassword() {
    const newPass = document.getElementById('resetNewPass').value.trim();
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    
    if (!newPass) {
        showToast('Enter a new password', 'error');
        return;
    }
    if (!token) return;
    
    try {
        const res = await fetch('/api/auth/reset-password/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, new_password: newPass })
        });
        if (res.ok) {
            showToast('Password reset successful. You can now login.');
            document.getElementById('resetPasswordModal').style.display = 'none';
            window.history.replaceState({}, document.title, "/");
        } else {
            const data = await res.json();
            document.getElementById('resetError').textContent = data.detail || 'Reset failed';
        }
    } catch (err) { showToast(err.message, 'error'); }
}

window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('token')) {
        document.getElementById('resetPasswordModal').style.display = 'flex';
    }
});
