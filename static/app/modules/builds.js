import { state } from './state.js';
import { getAuthHeaders, escapeHtml, timeAgo } from './utils.js';
import { showToast } from './toast.js';
import { refreshLogList } from './sidebar.js';
import { switchView } from './view.js';
import { openConfirmDeleteModal, closeDeleteModal } from './modals.js';

export async function createBuild(payload) {
    const res = await fetch('/api/builds', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to create build');
    return data;
}

export async function renameBuild(id, name) {
    const res = await fetch(`/api/builds/${id}`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to rename build');
    return data;
}

export async function deleteBuild(id) {
    const res = await fetch(`/api/builds/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to delete build');
    }
}

export async function moveLogToBuild(logId, buildId) {
    const res = await fetch(`/api/logs/${logId}/build`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ build_id: buildId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to move log');
    return data;
}

export function newBuildPrompt() {
    openNewBuildModal();
}

export function openNewBuildModal(onCreate = null) {
    state.pendingBuildCallback = onCreate;
    const modal = document.getElementById('newBuildModal');
    if (modal) {
        document.getElementById('newBuildInput').value = '';
        document.getElementById('newBuildVin').value = '';
        document.getElementById('newBuildVehicle').value = '';
        document.getElementById('newBuildCustomer').value = '';
        document.getElementById('newBuildNotes').value = '';
        document.getElementById('newBuildStatus').value = '';
        modal.style.display = 'flex';
        setTimeout(() => document.getElementById('newBuildInput').focus(), 50);
    }
}

export function closeNewBuildModal() {
    const modal = document.getElementById('newBuildModal');
    if (modal) modal.style.display = 'none';
    state.pendingBuildCallback = null;
}

export async function submitNewBuild() {
    const name = document.getElementById('newBuildInput').value.trim();
    if (!name) {
        showToast('Build name is required', 'error');
        return;
    }

    const payload = {
        name,
        vin: document.getElementById('newBuildVin').value.trim(),
        vehicle_model: document.getElementById('newBuildVehicle').value.trim(),
        customer_name: document.getElementById('newBuildCustomer').value.trim(),
        notes: document.getElementById('newBuildNotes').value.trim(),
        status: document.getElementById('newBuildStatus').value || null
    };

    const cb = state.pendingBuildCallback;
    closeNewBuildModal();
    try {
        const build = await createBuild(payload);
        showToast('Build created');
        if (cb) await cb(build);
        await refreshLogList();
    } catch (err) { showToast(err.message, 'error'); }
}

export function closeBuildPicker() {
    document.getElementById('buildPicker')?.remove();
}

export function showBuildPicker(buttonEl, logId, currentBuildId) {
    closeBuildPicker();

    const picker = document.createElement('div');
    picker.className = 'build-picker';
    picker.id = 'buildPicker';

    const opts = [
        { id: null, name: 'Unassigned' },
        ...state.currentBuilds,
        { id: '__new__', name: '+ New build…' }
    ];

    opts.forEach(opt => {
        const item = document.createElement('button');
        item.className = 'build-picker-item';
        if (opt.id === currentBuildId) item.classList.add('active');
        item.textContent = opt.name;
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            closeBuildPicker();
            try {
                if (opt.id === '__new__') {
                    openNewBuildModal(async (build) => {
                        await moveLogToBuild(logId, build.id);
                        showToast('Log moved');
                    });
                    return;
                }
                await moveLogToBuild(logId, opt.id);
                showToast('Log moved');
                refreshLogList();
            } catch (err) { showToast(err.message, 'error'); }
        });
        picker.appendChild(item);
    });

    document.body.appendChild(picker);
    const rect = buttonEl.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();
    picker.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - pickerRect.height - 8)}px`;
    picker.style.left = `${Math.max(8, rect.right - pickerRect.width)}px`;

    setTimeout(() => {
        const dismiss = (ev) => {
            if (!picker.contains(ev.target)) closeBuildPicker();
            else document.addEventListener('click', dismiss, { once: true });
        };
        document.addEventListener('click', dismiss, { once: true });
    }, 0);
}

export async function openBuildDetails() {
    if (state.libraryFilter === 'all' || state.libraryFilter === 'unassigned') return;
    try {
        const res = await fetch(`/api/builds/${state.libraryFilter}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('detName').value = data.name || '';
            document.getElementById('detVin').value = data.vin || '';
            document.getElementById('detVehicle').value = data.vehicle_model || '';
            document.getElementById('detCustomer').value = data.customer_name || '';
            document.getElementById('detNotes').value = data.notes || '';
            document.getElementById('detStatus').value = data.status || '';
            document.getElementById('buildDetailsModal').style.display = 'flex';
        }
    } catch (err) { showToast('Failed to load build details', 'error'); }
}

export function closeBuildDetails() {
    document.getElementById('buildDetailsModal').style.display = 'none';
}

export async function saveBuildDetails() {
    const payload = {
        name: document.getElementById('detName').value.trim(),
        vin: document.getElementById('detVin').value.trim(),
        vehicle_model: document.getElementById('detVehicle').value.trim(),
        customer_name: document.getElementById('detCustomer').value.trim(),
        notes: document.getElementById('detNotes').value.trim(),
        status: document.getElementById('detStatus').value || null
    };
    try {
        const res = await fetch(`/api/builds/${state.libraryFilter}`, {
            method: 'PATCH',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast('Build details updated');
            closeBuildDetails();
            refreshLogList();
        } else {
            const err = await res.json();
            showToast(err.detail || 'Update failed', 'error');
        }
    } catch (err) { showToast(err.message, 'error'); }
}

function getBuildStatus(b) {
    if (b.status) {
        const map = {
            'active': { label: 'Active', cls: 'status-active' },
            'in_progress': { label: 'In Progress', cls: 'status-progress' },
            'on_hold': { label: 'On Hold', cls: 'status-hold' },
            'completed': { label: 'Completed', cls: 'status-completed' }
        };
        return map[b.status] || { label: b.status, cls: 'status-new' };
    }
    if (!b.log_count) return { label: 'New', cls: 'status-new' };
    if (!b.last_activity) return { label: 'Idle', cls: 'status-idle' };
    const diff = Date.now() - new Date(b.last_activity).getTime();
    const days = diff / (1000 * 60 * 60 * 24);
    if (days < 3) return { label: 'Active', cls: 'status-active' };
    if (days < 14) return { label: 'In Progress', cls: 'status-progress' };
    return { label: 'Completed', cls: 'status-completed' };
}

export function renderBuildsView() {
    const grid = document.getElementById('buildsGrid');
    const countLabel = document.getElementById('buildsCountLabel');
    const search = document.getElementById('buildsSearch')?.value.toLowerCase() || '';
    if (!grid) return;

    const filtered = state.currentBuilds.filter(b =>
        b.name.toLowerCase().includes(search) ||
        (b.vin && b.vin.toLowerCase().includes(search)) ||
        (b.vehicle_model && b.vehicle_model.toLowerCase().includes(search)) ||
        (b.customer_name && b.customer_name.toLowerCase().includes(search))
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

    filtered.forEach(b => {
        const status = getBuildStatus(b);
        const lastAgo = timeAgo(b.last_activity);
        const card = document.createElement('div');
        card.className = 'build-mgr-card';
        card.innerHTML = `
            <div class="build-mgr-header">
                <div class="build-mgr-title">
                    <h3>${escapeHtml(b.name)}</h3>
                    <span class="garage-status ${status.cls}">${status.label}</span>
                </div>
                <div class="build-mgr-actions">
                    <button data-action="editBuildFromView" data-id="${b.id}" title="Edit">✏️</button>
                    <button class="danger" data-action="deleteBuildFromView" data-id="${b.id}" data-name="${escapeHtml(b.name)}" title="Delete">🗑️</button>
                </div>
            </div>
            <div class="build-mgr-body">
                <div class="garage-stats-row">
                    <div class="garage-stat">
                        <span class="garage-stat-value">${b.log_count || 0}</span>
                        <span class="garage-stat-label">Logs</span>
                    </div>
                    <div class="garage-stat">
                        <span class="garage-stat-value">${lastAgo || '—'}</span>
                        <span class="garage-stat-label">Last Activity</span>
                    </div>
                </div>
                <div class="garage-details-row">
                    <div class="build-mgr-detail">
                        <label>Vehicle</label>
                        <span>${escapeHtml(b.vehicle_model || '—')}</span>
                    </div>
                    <div class="build-mgr-detail">
                        <label>VIN</label>
                        <span class="vin-mono">${escapeHtml(b.vin || '—')}</span>
                    </div>
                    <div class="build-mgr-detail">
                        <label>Customer</label>
                        <span>${escapeHtml(b.customer_name || '—')}</span>
                    </div>
                </div>
            </div>
            <div class="build-mgr-footer">
                <button data-action="viewBuildLogs" data-id="${b.id}">Open Logs →</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

export function viewBuildLogs(buildId) {
    state.libraryFilter = buildId;
    switchView('library');
}

export async function editBuildFromView(buildId) {
    state.libraryFilter = buildId;
    openBuildDetails();
}

export function openDeleteModal(id, name) {
    openConfirmDeleteModal({
        subtitle: 'Datalogs will be unassigned but NOT deleted.',
        body: `Are you sure you want to delete the build <strong>"${escapeHtml(name)}"</strong>?<br><br>All related logs will be safely preserved in the <strong>Unassigned</strong> category.`,
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/builds/${id}`, {
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

export async function deleteBuildFromView(id, name) {
    openDeleteModal(id, name);
}
