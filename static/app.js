let authToken = localStorage.getItem('boostlog_token') || null;
let authMode = 'login';
let currentServerFile = null;

function setActiveLog(name, listItem = null) {
    // Update page title
    const title = document.getElementById('pageTitle');
    if (title) title.textContent = name || 'Telemetry Dashboard';
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
}

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
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
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username: u, password: p})
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Registration failed');
            
            // Auto login
            switchAuthTab('login');
            await performLogin(u, p);
        } else {
            await performLogin(u, p);
        }
    } catch(err) {
        errorEl.textContent = err.message;
    }
}

async function performLogin(username, password) {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    
    const res = await fetch('/token', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
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
const valSpeed = document.getElementById('valSpeed');

let currentChart = null;
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

// Removed dropZone native click listener to prevent double-opening since input overlay handles it

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
        handleFile(e.target.files[0]);
    }
});

// Load logs on startup
initAuth();

function handleFile(file) {
    if (!file.name.endsWith('.csv')) {
        alert('Please upload a CSV file.');
        return;
    }

    // Upload to backend silently to archive, which refreshes the recent logs list
    uploadToBackend(file);
    setActiveLog(file.name);

    // Parse CSV locally in the browser for instant visualization
    Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function(results) {
            console.log("Parsed CSV:", results.data.length, "rows");
            currentData = results.data;
            currentHeaders = results.meta.fields;
            
            processDataForGraph();
        },
        error: function(err) {
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
            renderChart();
        });

        paramToggles.appendChild(lbl);
    });

    xAxisSelect.addEventListener('change', renderChart);
    
    // Calculate simple metrics for the UI metrics card
    calculateMetrics();
    renderChart();
    
    document.getElementById('btnAnalyze').disabled = false;
}

function calculateMetrics() {
    let maxB = null;
    let maxR = null;
    let maxT = null;
    let maxTrq = null;
    let maxSpd = null;

    const boostCol = currentHeaders.find(h => h.toLowerCase().includes('boost') && !h.toLowerCase().includes('target'));
    const rpmCol = currentHeaders.find(h => h.toLowerCase() === 'rpm' || h.toLowerCase().includes('engine speed'));
    const timingCol = currentHeaders.find(h => h.toLowerCase().includes('timing corr'));
    const torqueCol = currentHeaders.find(h => h.toLowerCase().includes('torque at clutch (actual)')) || currentHeaders.find(h => h.toLowerCase().includes('torque') || h.toLowerCase().includes('trq'));
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
    });

    if (boostCol && maxB !== null) valBoost.textContent = maxB.toFixed(1); else valBoost.textContent = '--';
    if (rpmCol && maxR !== null) valRpm.textContent = maxR.toFixed(0); else valRpm.textContent = '--';
    if (timingCol && maxT !== null) valTiming.textContent = maxT.toFixed(1); else valTiming.textContent = '--';
    if (torqueCol && maxTrq !== null) valTorque.textContent = maxTrq.toFixed(0); else valTorque.textContent = '--';
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
    
    // We create multiple Y-axes for parameters with completely different scales (e.g. RPM vs Boost)
    checkboxes.forEach((cb, i) => {
        const header = cb.value;
        const color = lineColors[currentHeaders.indexOf(header) % lineColors.length];
        const data = currentData.map(row => row[header]);
        
        const isRpm = header.toLowerCase().includes('rpm');
        
        datasets.push({
            label: header,
            data: data,
            borderColor: color,
            backgroundColor: `${color}1A`, // 10% opacity
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.2, // Smooth curves
            yAxisID: isRpm ? 'y-rpm' : 'y' // Send RPM to right axis
        });
    });

    const ctx = document.getElementById('mainChart').getContext('2d');
    
    // Decimation options for performance if the log is huge
    const decimation = {
        enabled: true,
        algorithm: 'lttb', // Largest Triangle Three Buckets
        samples: 500,
    };

    currentChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: { labels: { color: '#E0E4EB' } },
                tooltip: { backgroundColor: 'rgba(24, 28, 37, 0.9)', titleColor: '#3A86FF' },
                decimation: decimation
            },
            scales: {
                x: {
                    grid: { color: '#2A303F' },
                    ticks: { color: '#8B94A5' }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: { color: '#2A303F' },
                    ticks: { color: '#8B94A5' }
                },
                'y-rpm': {
                    type: 'linear',
                    display: datasets.some(d => d.yAxisID === 'y-rpm'),
                    position: 'right',
                    grid: { drawOnChartArea: false }, // Avoid gridline clash
                    ticks: { color: '#FFBE0B' }
                }
            }
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
        console.log('File archived to backend:', data);
        refreshLogList();
        setDownloadLink(data.url, data.filename);
    })
    .catch(err => console.error('Upload to backend failed:', err));
}

function setDownloadLink(url, filename) {
    if (url) currentServerFile = url.split('/').pop();
    const btnDownload = document.getElementById('btnDownload');
    if (btnDownload && url) {
        btnDownload.href = url;
        btnDownload.download = filename || 'log.csv';
        btnDownload.style.display = 'inline-block';
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
                if (btnAnalyze) { btnAnalyze.disabled = false; btnAnalyze.innerHTML = 'Start Analysis'; }
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
            if (btnAnalyze) { btnAnalyze.disabled = false; btnAnalyze.innerHTML = '🔄 Re-run Analysis'; }
            if (fabAi) fabAi.disabled = false;

            // Auto-open drawer to show cached result
            if (!document.getElementById('aiDrawer').classList.contains('open')) {
                toggleAiDrawer();
            }
        })
        .catch(() => {
            historySection.style.display = 'none';
            chatBox.innerHTML = '<div class="msg system">Ready for AI Analysis. Click the turbo button to begin.</div>';
            if (btnAnalyze) { btnAnalyze.disabled = false; btnAnalyze.innerHTML = 'Start Analysis'; }
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
    if (!currentServerFile) return;
    
    const btn = document.getElementById('btnAnalyze');
    const chatBox = document.getElementById('chatBox');
    
    btn.disabled = true;
    btn.innerHTML = 'Analyzing...';
    chatBox.innerHTML = '<div class="msg system">Agent is crunching telemetry...</div><div style="display:flex; justify-content:center; padding: 20px;"><div class="spinner" style="width:24px; height:24px; border:3px solid rgba(255,255,255,0.1); border-top-color:var(--accent); border-radius:50%; animation:spin 1s linear infinite;"></div></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
    
    try {
        const res = await fetch(`/api/analyze/${currentServerFile}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.detail || 'Analysis failed');
        
        // Reload full history so the new run appears as a pill
        loadAnalysisHistory(currentServerFile);
        // Auto-open the drawer to show results
        if (!document.getElementById('aiDrawer').classList.contains('open')) {
            toggleAiDrawer();
        }
    } catch(err) {
        chatBox.innerHTML = `<div class="msg" style="color: var(--danger);">Error: ${err.message}</div>`;
        btn.disabled = false;
        btn.innerHTML = 'Retry Analysis';
    }
}

function refreshLogList() {
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
                } catch(_) {}

                // Task 2: Format the uploaded_at timestamp
                let timeLabel = '';
                if (log.uploaded_at) {
                    const d = new Date(log.uploaded_at);
                    timeLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                              + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                }

                const li = document.createElement('li');
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
            }
        })
        .catch(err => console.error('Error fetching logs:', err));
}

function loadServerLog(log, listItem = null) {
    setActiveLog(log.name, listItem);
    
    fetch(log.url, { headers: getAuthHeaders() })
        .then(res => res.text())
        .then(csvText => {
            Papa.parse(csvText, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: function(results) {
                    currentData = results.data;
                    currentHeaders = results.meta.fields;
                    processDataForGraph();
                    setDownloadLink(log.url, log.name);
                }
            });
        })
        .catch(err => console.error('Error loading historic log:', err));
}async function renameLog(logId, currentName) {
    const newName = prompt('Enter new name for the log:', currentName);
    if (!newName || newName === currentName) return;
    
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
        
        showToast('Log renamed successfully');
        refreshLogList();
    } catch (err) {
        showToast(err.message, 'error');
    }
}
