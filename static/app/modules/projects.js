import { state } from './state.js';
import { getAuthHeaders, escapeHtml, timeAgo } from './utils.js';
import { showToast } from './toast.js';
import { refreshLogList } from './sidebar.js';
import { switchView } from './view.js';
import { openConfirmDeleteModal, closeDeleteModal } from './modals.js';

export async function createProject(payload) {
    const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to create build');
    return data;
}

export async function renameProject(id, name) {
    const res = await fetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to rename build');
    return data;
}

export async function deleteProject(id) {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to delete build');
    }
}

export async function moveLogToProject(logId, projectId) {
    const res = await fetch(`/api/logs/${logId}/project`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to move log');
    return data;
}

export function newProjectPrompt() {
    openNewProjectModal();
}

export function openNewProjectModal(onCreate = null) {
    state.pendingProjectCallback = onCreate;
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

export function closeNewProjectModal() {
    const modal = document.getElementById('newProjectModal');
    if (modal) modal.style.display = 'none';
    state.pendingProjectCallback = null;
}

export async function submitNewProject() {
    const name = document.getElementById('newProjectInput').value.trim();
    if (!name) {
        showToast('Build name is required', 'error');
        return;
    }

    const payload = {
        name,
        vin: document.getElementById('newProjectVin').value.trim(),
        vehicle_model: document.getElementById('newProjectVehicle').value.trim(),
        customer_name: document.getElementById('newProjectCustomer').value.trim(),
        notes: document.getElementById('newProjectNotes').value.trim(),
        status: document.getElementById('newProjectStatus').value || null
    };

    const cb = state.pendingProjectCallback;
    closeNewProjectModal();
    try {
        const proj = await createProject(payload);
        showToast('Build created');
        if (cb) await cb(proj);
        await refreshLogList();
    } catch (err) { showToast(err.message, 'error'); }
}

export function closeProjectPicker() {
    document.getElementById('projectPicker')?.remove();
}

export function showProjectPicker(buttonEl, logId, currentProjectId) {
    closeProjectPicker();

    const picker = document.createElement('div');
    picker.className = 'project-picker';
    picker.id = 'projectPicker';

    const opts = [
        { id: null, name: 'Unassigned' },
        ...state.currentProjects,
        { id: '__new__', name: '+ New build…' }
    ];

    opts.forEach(opt => {
        const item = document.createElement('button');
        item.className = 'project-picker-item';
        if (opt.id === currentProjectId) item.classList.add('active');
        item.textContent = opt.name;
        item.addEventListener('click', async (e) => {
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
            if (!picker.contains(ev.target)) closeProjectPicker();
            else document.addEventListener('click', dismiss, { once: true });
        };
        document.addEventListener('click', dismiss, { once: true });
    }, 0);
}

export async function openProjectDetails() {
    if (state.libraryFilter === 'all' || state.libraryFilter === 'unassigned') return;
    try {
        const res = await fetch(`/api/projects/${state.libraryFilter}`, { headers: getAuthHeaders() });
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

export function closeProjectDetails() {
    document.getElementById('projectDetailsModal').style.display = 'none';
}

export async function saveProjectDetails() {
    const payload = {
        name: document.getElementById('detName').value.trim(),
        vin: document.getElementById('detVin').value.trim(),
        vehicle_model: document.getElementById('detVehicle').value.trim(),
        customer_name: document.getElementById('detCustomer').value.trim(),
        notes: document.getElementById('detNotes').value.trim(),
        status: document.getElementById('detStatus').value || null
    };
    try {
        const res = await fetch(`/api/projects/${state.libraryFilter}`, {
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

function getProjectStatus(p) {
    if (p.status) {
        const map = {
            'active': { label: 'Active', cls: 'status-active' },
            'in_progress': { label: 'In Progress', cls: 'status-progress' },
            'on_hold': { label: 'On Hold', cls: 'status-hold' },
            'completed': { label: 'Completed', cls: 'status-completed' }
        };
        return map[p.status] || { label: p.status, cls: 'status-new' };
    }
    if (!p.log_count) return { label: 'New', cls: 'status-new' };
    if (!p.last_activity) return { label: 'Idle', cls: 'status-idle' };
    const diff = Date.now() - new Date(p.last_activity).getTime();
    const days = diff / (1000 * 60 * 60 * 24);
    if (days < 3) return { label: 'Active', cls: 'status-active' };
    if (days < 14) return { label: 'In Progress', cls: 'status-progress' };
    return { label: 'Completed', cls: 'status-completed' };
}

export function renderProjectsView() {
    const grid = document.getElementById('projectsGrid');
    const countLabel = document.getElementById('projectsCountLabel');
    const search = document.getElementById('projectsSearch')?.value.toLowerCase() || '';
    if (!grid) return;

    const filtered = state.currentProjects.filter(p =>
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
                    <h3>${escapeHtml(p.name)}</h3>
                    <span class="garage-status ${status.cls}">${status.label}</span>
                </div>
                <div class="project-mgr-actions">
                    <button data-action="editProjectFromView" data-id="${p.id}" title="Edit">✏️</button>
                    <button class="danger" data-action="deleteProjectFromView" data-id="${p.id}" data-name="${escapeHtml(p.name)}" title="Delete">🗑️</button>
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
                        <span>${escapeHtml(p.vehicle_model || '—')}</span>
                    </div>
                    <div class="project-mgr-detail">
                        <label>VIN</label>
                        <span class="vin-mono">${escapeHtml(p.vin || '—')}</span>
                    </div>
                    <div class="project-mgr-detail">
                        <label>Customer</label>
                        <span>${escapeHtml(p.customer_name || '—')}</span>
                    </div>
                </div>
            </div>
            <div class="project-mgr-footer">
                <button data-action="viewProjectLogs" data-id="${p.id}">Open Logs →</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

export function viewProjectLogs(projectId) {
    state.libraryFilter = projectId;
    switchView('library');
}

export async function editProjectFromView(projectId) {
    state.libraryFilter = projectId;
    openProjectDetails();
}

export function openDeleteModal(id, name) {
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

export async function deleteProjectFromView(id, name) {
    openDeleteModal(id, name);
}
