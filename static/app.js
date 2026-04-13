let authToken = localStorage.getItem('boostlog_token') || null;
let authMode = 'login';
let currentServerFile = null;

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
    
    document.querySelector('.status-badge').classList.add('active');
    document.querySelector('.status-badge').innerHTML = 'Data Loaded - Agent Ready';
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
    if (btnAnalyze) btnAnalyze.disabled = false;
    
    const chatBox = document.getElementById('chatBox');
    if (chatBox) chatBox.innerHTML = '<div class="msg system">Ready for AI Analysis. Click the sidebar button to scan.</div>';
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
        
        chatBox.innerHTML = `<div class="markdown-body" style="padding: 10px; font-size: 14px; text-align: left; color: var(--text-primary);">${marked.parse(data.analysis)}</div>`;
    } catch(err) {
        chatBox.innerHTML = `<div class="msg" style="color: var(--danger);">Error: ${err.message}</div>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Run AI Analysis';
    }
}

function refreshLogList() {
    fetch('/api/logs', { headers: getAuthHeaders() })
        .then(res => res.json())
        .then(data => {
            if (!data.logs || data.logs.length === 0) return;
            logItems.innerHTML = '';
            data.logs.forEach(log => {
                const li = document.createElement('li');
                li.innerHTML = `📊 ${log.name}`;
                li.onclick = () => loadServerLog(log);
                logItems.appendChild(li);
            });
        })
        .catch(err => console.error('Error fetching logs:', err));
}

function loadServerLog(log) {
    document.querySelector('.status-badge').innerHTML = 'Fetching Historic Data...';
    
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
}
