import { state } from './state.js';
import { showToast } from './toast.js';
import { renameLog } from './modals.js';
import { switchView } from './view.js';
import { loadServerLog, refreshLogList } from './sidebar.js';
import {
    renameProject,
    deleteProject,
    moveLogToProject,
    showProjectPicker,
    openNewProjectModal,
} from './projects.js';

export function renderLibrary() {
    renderLibraryRail();
    renderLibraryLogs();
}

function renderLibraryRail() {
    const smart = document.getElementById('railSmart');
    const projects = document.getElementById('railProjects');
    if (!smart || !projects) return;

    const unassignedCount = state.currentLogs.filter(l => l.project_id == null).length;

    const smartItems = [
        { key: 'all', name: 'All Logs', count: state.currentLogs.length },
        { key: 'unassigned', name: 'Unassigned', count: unassignedCount },
    ];

    smart.innerHTML = '';
    for (const item of smartItems) {
        smart.appendChild(buildRailItem(item.key, item.name, item.count, false));
    }

    projects.innerHTML = '';
    if (state.currentProjects.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'rail-empty';
        empty.textContent = 'No projects yet';
        projects.appendChild(empty);
    } else {
        for (const p of state.currentProjects) {
            const count = state.currentLogs.filter(l => l.project_id === p.id).length;
            projects.appendChild(buildRailItem(p.id, p.name, count, true));
        }
    }
}

function buildRailItem(key, name, count, withActions) {
    const li = document.createElement('li');
    li.className = 'rail-item' + (String(state.libraryFilter) === String(key) ? ' active' : '');
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
        state.libraryFilter = key;
        clearBulkSelection();
        renderLibrary();
    });
    if (withActions) {
        li.querySelector('.rail-rename').addEventListener('click', async (e) => {
            e.stopPropagation();
            const next = prompt('Rename project:', name);
            if (!next || next.trim() === name) return;
            try {
                await renameProject(key, next.trim());
                showToast('Build renamed');
                refreshLogList();
            } catch (err) { showToast(err.message, 'error'); }
        });
        li.querySelector('.rail-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete project "${name}"? Logs will move back to Unassigned.`)) return;
            try {
                await deleteProject(key);
                if (state.libraryFilter === key) state.libraryFilter = 'all';
                showToast('Build deleted');
                refreshLogList();
            } catch (err) { showToast(err.message, 'error'); }
        });
    }
    return li;
}

function getFilteredLibraryLogs() {
    let logs = state.currentLogs.slice();
    if (state.libraryFilter === 'all') {
        // no-op
    } else if (state.libraryFilter === 'unassigned') {
        logs = logs.filter(l => l.project_id == null);
    } else {
        logs = logs.filter(l => String(l.project_id) === String(state.libraryFilter));
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

export function renderLibraryLogs() {
    const grid = document.getElementById('libraryGrid');
    const empty = document.getElementById('libraryEmpty');
    const title = document.getElementById('libraryActiveTitle');
    const countPill = document.getElementById('libraryActiveCount');
    if (!grid) return;

    if (state.libraryFilter === 'all') title.textContent = 'All Logs';
    else if (state.libraryFilter === 'unassigned') title.textContent = 'Unassigned';
    else {
        const proj = state.currentProjects.find(p => p.id === state.libraryFilter);
        title.textContent = proj ? proj.name : 'Build';
    }

    const logs = getFilteredLibraryLogs();
    countPill.textContent = logs.length;

    const btnDetails = document.getElementById('btnProjectDetails');
    if (btnDetails) {
        btnDetails.style.display = (state.libraryFilter !== 'all' && state.libraryFilter !== 'unassigned') ? 'flex' : 'none';
    }

    grid.innerHTML = '';
    if (logs.length === 0) {
        empty.style.display = 'block';
        empty.querySelector('p').textContent =
            state.currentLogs.length === 0
                ? 'No logs uploaded yet. Click "Upload Boostlog" in the sidebar to get started.'
                : 'No logs match your filter.';
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
    card.className = 'log-card' + (state.bulkSelection.has(log.id) ? ' selected' : '');
    const proj = log.project_id != null ? state.currentProjects.find(p => p.id === log.project_id) : null;
    const hasAi = state.hasAnalysisById.get(log.id);
    let timeLabel = '';
    if (log.uploaded_at) {
        const d = new Date(log.uploaded_at);
        timeLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    card.innerHTML = `
        <label class="log-card-check" title="Select">
            <input type="checkbox" ${state.bulkSelection.has(log.id) ? 'checked' : ''}>
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
            <button class="log-card-btn" data-act="open" title="Analyze in Dyno">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 12 7 12 10 4 14 20 17 12 21 12"></polyline>
                </svg>
            </button>
            <button class="log-card-btn" data-act="move" title="Move to build">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
            </button>
            <button class="log-card-btn" data-act="rename" title="Rename">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
        </div>
    `;

    const checkbox = card.querySelector('.log-card-check input');
    checkbox.addEventListener('change', (e) => {
        if (e.target.checked) state.bulkSelection.add(log.id);
        else state.bulkSelection.delete(log.id);
        card.classList.toggle('selected', e.target.checked);
        refreshBulkBar();
    });
    card.querySelector('.log-card-check').addEventListener('click', (e) => e.stopPropagation());

    card.querySelector('[data-act="open"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openLogFromLibrary(log);
    });
    card.querySelector('[data-act="move"]').addEventListener('click', (e) => {
        e.stopPropagation();
        showProjectPicker(e.currentTarget, log.id, log.project_id);
    });
    card.querySelector('[data-act="rename"]').addEventListener('click', (e) => {
        e.stopPropagation();
        renameLog(log.id, log.name);
    });
    card.querySelector('.log-card-body').addEventListener('click', () => openLogFromLibrary(log));

    return card;
}

function openLogFromLibrary(log) {
    switchView('dashboard');
    loadServerLog(log);
}

export function refreshBulkBar() {
    const bar = document.getElementById('libraryBulkBar');
    const count = document.getElementById('libraryBulkCount');
    if (!bar) return;
    if (state.bulkSelection.size === 0) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = 'flex';
    count.textContent = `${state.bulkSelection.size} selected`;
}

export function clearBulkSelection() {
    state.bulkSelection.clear();
    refreshBulkBar();
    if (state.currentView === 'library') renderLibraryLogs();
}

export function openMoveLogsModal() {
    if (state.bulkSelection.size === 0) return;
    const modal = document.getElementById('moveLogsModal');
    const select = document.getElementById('moveBuildSelect');
    const context = document.getElementById('moveLogsContext');

    if (!modal || !select) return;

    select.innerHTML = '<option value="unassigned">Unassigned (None)</option>';
    state.currentProjects.forEach(p => {
        select.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });
    select.innerHTML += `<option value="new">+ Create New Build...</option>`;

    context.textContent = `Moving ${state.bulkSelection.size} selected log(s)`;
    modal.style.display = 'flex';
}

export function closeMoveLogsModal() {
    document.getElementById('moveLogsModal').style.display = 'none';
}

export async function submitMoveLogs() {
    const val = document.getElementById('moveBuildSelect').value;
    const idsToMove = [...state.bulkSelection];

    closeMoveLogsModal();

    if (val === 'new') {
        openNewProjectModal(async (proj) => {
            await Promise.all(idsToMove.map(id => moveLogToProject(id, proj.id)));
            showToast(`Moved ${idsToMove.length} log(s) to ${proj.name}`);
            state.bulkSelection.clear();
            await refreshLogList();
        });
        return;
    }

    const targetId = val === 'unassigned' ? null : parseInt(val, 10);
    try {
        await Promise.all(idsToMove.map(id => moveLogToProject(id, targetId)));
        const targetName = targetId === null ? 'Unassigned' : state.currentProjects.find(p => p.id === targetId)?.name || 'Build';
        showToast(`Moved ${idsToMove.length} log(s) to ${targetName}`);
        state.bulkSelection.clear();
        await refreshLogList();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

export function bulkMovePrompt() {
    openMoveLogsModal();
}
