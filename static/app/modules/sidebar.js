import { state, SIDEBAR_LOG_LIMIT } from './state.js';
import { getAuthHeaders } from './utils.js';
import { showToast } from './toast.js';
import { renameLog } from './modals.js';
import { switchView } from './view.js';
import { renderLibrary } from './library.js';
import { renderBuildsView } from './builds.js';
import { processDataForGraph } from './chart.js';
import { setDownloadLink } from './upload.js';

export function setActiveLog(id, name, listItem = null) {
    state.currentLogId = id;
    const title = document.getElementById('pageTitle');
    if (title) {
        title.textContent = name || 'Interactive Datalog';
        if (id) title.classList.add('editable');
        else title.classList.remove('editable');
    }
    const fab = document.getElementById('fabAi');
    if (fab) fab.disabled = !id && !state.currentData;
    document.querySelectorAll('#logItems li').forEach(li => li.classList.remove('active-log'));
    if (listItem) listItem.classList.add('active-log');
}

export function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('open');
}

export function collapseSidebar() {
    document.getElementById('sidebar').classList.toggle('collapsed');
}

export async function refreshLogList(selectId = null, initialLoad = false) {
    try {
        const [logsRes, buildsRes] = await Promise.all([
            fetch('/api/logs', { headers: getAuthHeaders() }),
            fetch('/api/builds', { headers: getAuthHeaders() })
        ]);
        state.currentLogs = (await logsRes.json()).logs || [];
        state.currentBuilds = (await buildsRes.json()).builds || [];

        const analyses = await Promise.all(state.currentLogs.map(async (log) => {
            try {
                const stored = log.url.split('/').pop();
                const r = await fetch(`/api/analyze/${stored}`, { headers: getAuthHeaders() });
                return [log.id, Boolean((await r.json()).analysis)];
            } catch { return [log.id, false]; }
        }));
        state.hasAnalysisById = new Map(analyses);

        renderSidebarLogs(selectId);
        if (state.currentView === 'library') renderLibrary();
        if (state.currentView === 'builds') renderBuildsView();

        if (initialLoad && state.currentBuilds.length > 0 && state.currentView === 'dashboard') {
            switchView('builds');
        }
    } catch (err) {
        console.error('Error fetching logs/builds:', err);
    }
}

export function renderSidebarLogs(selectId = null) {
    const logItems = document.getElementById('logItems');
    logItems.innerHTML = '';

    if (state.currentLogs.length === 0) {
        logItems.innerHTML = '<li class="empty-state">No logs uploaded yet</li>';
        return;
    }

    const recent = state.currentLogs.slice(0, SIDEBAR_LOG_LIMIT);
    for (const log of recent) renderLogItem(log, state.hasAnalysisById.get(log.id), selectId);

    if (state.currentLogs.length > SIDEBAR_LOG_LIMIT) {
        const more = document.createElement('li');
        more.className = 'view-all-link';
        more.innerHTML = `View all ${state.currentLogs.length} in Library <span aria-hidden="true">→</span>`;
        more.addEventListener('click', () => switchView('library'));
        logItems.appendChild(more);
    }
}

function renderLogItem(log, hasAnalysis, selectId) {
    const logItems = document.getElementById('logItems');
    let timeLabel = '';
    if (log.uploaded_at) {
        const d = new Date(log.uploaded_at);
        timeLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    const li = document.createElement('li');
    if (state.currentLogId && log.id === state.currentLogId) li.classList.add('active-log');

    const proj = log.build_id != null ? state.currentBuilds.find(b => b.id === log.build_id) : null;

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

    li.querySelector('.rename-log-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        renameLog(log.id, log.name);
    });
    li.addEventListener('click', () => loadServerLog(log, li));
    logItems.appendChild(li);

    if (selectId && log.id === selectId) setActiveLog(log.id, log.name, li);
}

export function loadServerLog(log, listItem = null) {
    const logFilename = log.url.split('/').pop();
    if (state.analysisRunning && state.analysisRunningFile !== logFilename) {
        showToast(`Analysis in progress on "${state.analysisRunningName}" — please wait`, 'info');
        return;
    }
    setActiveLog(log.id, log.name, listItem);

    if (state.currentView !== 'dashboard') {
        switchView('dashboard');
    }

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
                    state.currentData = results.data;
                    state.currentHeaders = results.meta.fields;
                    processDataForGraph();
                    setDownloadLink(log.url, log.name);
                }
            });
        })
        .catch(err => console.error('Error loading historic log:', err));
}
