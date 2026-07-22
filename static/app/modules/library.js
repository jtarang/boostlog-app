import { state, FREE_LOG_LIMIT } from './state.js';
import { showToast } from './toast.js';
import { getAuthHeaders, escapeHtml } from './utils.js';
import { renameLog, openConfirmDeleteModal } from './modals.js';
import { switchView } from './view.js';
import { loadServerLog, refreshLogList } from './sidebar.js';
import { preSelectTuningLogs } from './tuning.js';
import {
    renameBuild,
    deleteBuild,
    moveLogToBuild,
    showBuildPicker,
    openNewBuildModal,
} from './builds.js';
import { renderBootmod3Panel } from './bootmod3.js';

export function renderLibrary() {
    renderLibraryRail();
    renderLibraryLogs();
}

function renderLibraryRail() {
    const smart = document.getElementById('railSmart');
    const builds = document.getElementById('railBuilds');
    if (!smart || !builds) return;

    const unassignedCount = state.currentLogs.filter(l => l.build_id == null).length;

    const smartItems = [
        { key: 'all', name: 'All Logs', count: state.currentLogs.length },
        { key: 'unassigned', name: 'Unassigned', count: unassignedCount },
    ];

    smart.innerHTML = '';
    for (const item of smartItems) {
        smart.appendChild(buildRailItem(item.key, item.name, item.count, false));
    }
    // Linked-account import tab. No count (remote logs load lazily on open).
    smart.appendChild(buildRailItem('bootmod3', 'bootmod3', '↗', false));

    builds.innerHTML = '';
    if (state.currentBuilds.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'rail-empty';
        empty.textContent = 'No builds yet';
        builds.appendChild(empty);
    } else {
        for (const b of state.currentBuilds) {
            const count = state.currentLogs.filter(l => l.build_id === b.id).length;
            builds.appendChild(buildRailItem(b.id, b.name, count, true));
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
                <button class="rail-delete" title="Delete build">
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
            const next = prompt('Rename build:', name);
            if (!next || next.trim() === name) return;
            try {
                await renameBuild(key, next.trim());
                showToast('Build renamed');
                refreshLogList();
            } catch (err) { showToast(err.message, 'error'); }
        });
        li.querySelector('.rail-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            openConfirmDeleteModal({
                title: 'Delete Build',
                subtitle: 'Datalogs will be unassigned but NOT deleted.',
                body: `Delete the build <strong>"${escapeHtml(name)}"</strong>? All related logs will be safely preserved in the <strong>Unassigned</strong> category.`,
                confirmText: 'Delete Build',
                onConfirm: async () => {
                    try {
                        await deleteBuild(key);
                        if (state.libraryFilter === key) state.libraryFilter = 'all';
                        showToast('Build deleted');
                        await refreshLogList();
                    } catch (err) { showToast(err.message, 'error'); }
                }
            });
        });
    }
    return li;
}

function getFilteredLibraryLogs() {
    let logs = state.currentLogs.slice();
    if (state.libraryFilter === 'all') {
        // no-op
    } else if (state.libraryFilter === 'unassigned') {
        logs = logs.filter(l => l.build_id == null);
    } else {
        logs = logs.filter(l => String(l.build_id) === String(state.libraryFilter));
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

    // The bootmod3 tab renders remote (not-yet-imported) logs; hand off entirely.
    if (state.libraryFilter === 'bootmod3') {
        document.getElementById('libraryBulkBar').style.display = 'none';
        renderBootmod3Panel(grid);
        return;
    }

    if (state.libraryFilter === 'all') title.textContent = 'All Logs';
    else if (state.libraryFilter === 'unassigned') title.textContent = 'Unassigned';
    else {
        const build = state.currentBuilds.find(b => b.id === state.libraryFilter);
        title.textContent = build ? build.name : 'Build';
    }

    const logs = getFilteredLibraryLogs();
    // Cap only applies account-wide (free tier), so only show it against the
    // unfiltered "All Logs" total, not per-build/unassigned counts.
    countPill.textContent = (state.libraryFilter === 'all' && state.subscriptionTier === 'free')
        ? `${state.currentLogs.length} / ${FREE_LOG_LIMIT}`
        : logs.length;

    const btnDetails = document.getElementById('btnBuildDetails');
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

// Deterministic per-log telemetry sparkline: a believable boost curve
// seeded by the log id, so every run card has its own signature trace.
function sparklineSvg(seed) {
    let s = (seed * 16807 + 17) % 2147483647;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };

    const N = 44, W = 220, H = 56;
    const k = 9 + rnd() * 9;            // spool sharpness
    const peak = 0.6 + rnd() * 0.32;    // peak boost
    const sag = 0.08 + rnd() * 0.28;    // top-end taper
    const yOf = (v) => (H - 7 - v * (H - 15)).toFixed(1);

    const line = [];
    const target = [];
    for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const spool = 1 / (1 + Math.exp(-k * (t - 0.34)));
        const base = spool * peak * (1 - sag * Math.max(0, t - 0.55));
        const x = (t * W).toFixed(1);
        line.push(`${x},${yOf(base + (rnd() - 0.5) * 0.035)}`);
        target.push(`${x},${yOf(spool * peak)}`);
    }

    const grid = [0.25, 0.5, 0.75]
        .map(f => `<line x1="0" y1="${(H * f).toFixed(1)}" x2="${W}" y2="${(H * f).toFixed(1)}" stroke="rgba(var(--fg-rgb),0.05)" stroke-width="1"/>`)
        .join('');

    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        ${grid}
        <polygon points="0,${H} ${line.join(' ')} ${W},${H}" fill="rgba(var(--accent-rgb),0.09)"/>
        <polyline points="${target.join(' ')}" fill="none" stroke="rgba(var(--fg-rgb),0.2)" stroke-width="1" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
        <polyline points="${line.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
    </svg>`;
}

function buildLogCard(log) {
    const card = document.createElement('article');
    card.className = 'log-card' + (state.bulkSelection.has(log.id) ? ' selected' : '');
    const build = log.build_id != null ? state.currentBuilds.find(b => b.id === log.build_id) : null;
    const hasAi = state.hasAnalysisById.get(log.id);
    let timeLabel = '';
    const when = log.recorded_at || log.uploaded_at;
    if (when) {
        const d = new Date(when);
        timeLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            + ' — ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    card.innerHTML = `
        <div class="log-card-top">
            <span class="log-card-run">RUN.${String(log.id).padStart(3, '0')}</span>
            <div class="log-card-flags">
                ${hasAi ? '<span class="analysis-badge" title="AI analysis available">✦ AI</span>' : ''}
                <label class="log-card-check" title="Select">
                    <input type="checkbox" ${state.bulkSelection.has(log.id) ? 'checked' : ''}>
                </label>
            </div>
        </div>
        <div class="log-card-body">
            <div class="log-card-spark" aria-hidden="true">${sparklineSvg(log.id)}</div>
            <span class="log-card-name" title="${log.name}">${log.name}</span>
            <div class="log-card-meta">
                ${build ? `<span class="log-card-build" title="${build.name}">${build.name}</span>` : '<span class="log-card-build muted">Unassigned</span>'}
            </div>
        </div>
        <div class="log-card-foot">
            <span class="log-card-time">${timeLabel}</span>
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
                <button class="log-card-btn log-card-btn-danger" data-act="delete" title="Delete">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
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
        showBuildPicker(e.currentTarget, log.id, log.build_id);
    });
    card.querySelector('[data-act="rename"]').addEventListener('click', (e) => {
        e.stopPropagation();
        renameLog(log.id, log.name);
    });
    card.querySelector('[data-act="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteLogFromLibrary(log);
    });
    card.querySelector('.log-card-body').addEventListener('click', () => openLogFromLibrary(log));

    return card;
}

function deleteLogFromLibrary(log) {
    openConfirmDeleteModal({
        title: 'Delete Log',
        subtitle: 'This also removes its AI analyses and chat history.',
        body: `Permanently delete <strong>"${escapeHtml(log.name)}"</strong>? This can't be undone.`,
        confirmText: 'Delete Log',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/logs/${log.id}`, { method: 'DELETE', headers: getAuthHeaders() });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.detail || `Delete failed (${res.status})`);
                }
                state.bulkSelection.delete(log.id);
                showToast('Log deleted');
                await refreshLogList();   // refresh sidebar + state.currentLogs
                renderLibraryLogs();      // re-render the library grid
                refreshBulkBar();
            } catch (err) {
                showToast(err.message, 'error');
            }
        },
    });
}

function openLogFromLibrary(log) {
    switchView('dashboard');
    loadServerLog(log);
}

export function refreshBulkBar() {
    const bar = document.getElementById('libraryBulkBar');
    const count = document.getElementById('libraryBulkCount');
    const compareBtn = document.getElementById('btnBulkCompare');
    if (!bar) return;
    if (state.bulkSelection.size === 0) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = 'flex';
    const n = state.bulkSelection.size;
    // Nudge toward the compare flow: it needs exactly two logs.
    count.textContent = n === 1 ? '1 selected · pick 1 more to compare' : `${n} selected`;
    if (compareBtn) compareBtn.style.display = n === 2 ? '' : 'none';
}

export function compareSelectedLogs() {
    if (state.bulkSelection.size !== 2) return;
    const ids = [...state.bulkSelection];
    const logs = ids.map(id => state.currentLogs.find(l => l.id === id)).filter(Boolean);
    if (logs.length !== 2) return;

    // Older log = baseline, newer = optimized (sorted by upload date).
    logs.sort((a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at));
    const storedOf = log => log.url.split('/').pop();
    preSelectTuningLogs(storedOf(logs[0]), storedOf(logs[1]));
    switchView('tuning');
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
    state.currentBuilds.forEach(b => {
        select.innerHTML += `<option value="${b.id}">${b.name}</option>`;
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
        openNewBuildModal(async (build) => {
            await Promise.all(idsToMove.map(id => moveLogToBuild(id, build.id)));
            showToast(`Moved ${idsToMove.length} log(s) to ${build.name}`);
            state.bulkSelection.clear();
            await refreshLogList();
        });
        return;
    }

    const targetId = val === 'unassigned' ? null : parseInt(val, 10);
    try {
        await Promise.all(idsToMove.map(id => moveLogToBuild(id, targetId)));
        const targetName = targetId === null ? 'Unassigned' : state.currentBuilds.find(b => b.id === targetId)?.name || 'Build';
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
