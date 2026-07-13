// bootmod3 linked-account integration (frontend).
//
// Two surfaces:
//   1. Settings card  -> link / unlink the account (loadBootmod3Status + link/unlink).
//   2. Datalogs rail   -> a "bootmod3" tab listing the account's remote logs with
//      checkboxes and an "Import selected" action (renderBootmod3Panel).
import { state } from './state.js';
import { showToast } from './toast.js';
import { getAuthHeaders, escapeHtml, timeAgo } from './utils.js';
import { refreshLogList } from './sidebar.js';

// Module-local cache + selection for the remote-log tab (kept out of global
// `state` so it can't collide with the local-log bulk selection).
const bm3 = {
    status: null,       // { linked, email, expired } | null (unknown)
    remoteLogs: null,   // normalized [{ id, name, subtitle }] | null (not loaded)
    loading: false,
    error: null,
    selection: new Set(),
};

export function bootmod3Status() {
    return bm3.status;
}

// ---- Settings: link / unlink -------------------------------------------------

export async function loadBootmod3Status() {
    try {
        const res = await fetch('/api/bootmod3/status', { headers: getAuthHeaders() });
        bm3.status = res.ok ? await res.json() : { linked: false };
    } catch {
        bm3.status = { linked: false };
    }
    renderBootmod3Settings();
}

function renderBootmod3Settings() {
    const box = document.getElementById('bm3SettingsBody');
    if (!box) return;
    const s = bm3.status || { linked: false };

    if (s.linked) {
        const warn = s.expired
            ? `<p class="bm3-warn">This link has expired — re-link to keep importing.</p>`
            : '';
        box.innerHTML = `
            <div class="bm3-status ${s.expired ? 'expired' : 'ok'}">
                <span class="bm3-dot"></span>
                <span>Linked${s.email ? ' as <strong>' + escapeHtml(s.email) + '</strong>' : ''}</span>
            </div>
            ${warn}
            <button class="btn-secondary" data-scramble="true" data-action="unlinkBootmod3"
                    style="margin-top:12px;">Unlink account</button>
        `;
    } else {
        box.innerHTML = `
            <p style="font-size:12px;color:var(--text-secondary);margin:-2px 0 12px;">
                Link your bootmod3 account to import datalogs by id from the Datalogs tab.
                Your password is never stored — only short-lived access tokens.
            </p>
            <div class="settings-grid">
                <div class="input-group">
                    <label>bootmod3 email</label>
                    <input type="email" id="bm3User" class="input-modern" placeholder="you@example.com" autocomplete="off">
                </div>
                <div class="input-group">
                    <label>bootmod3 password</label>
                    <input type="password" id="bm3Pass" class="input-modern" placeholder="••••••••" autocomplete="off">
                </div>
            </div>
            <button class="btn-primary" data-scramble="true" data-action="linkBootmod3">Link account</button>
        `;
    }
}

export async function linkBootmod3() {
    const username = document.getElementById('bm3User')?.value.trim();
    const password = document.getElementById('bm3Pass')?.value || '';
    if (!username || !password) {
        showToast('Enter your bootmod3 email and password', 'error');
        return;
    }
    try {
        const res = await fetch('/api/bootmod3/link', {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || `Link failed (${res.status})`);
        showToast(`bootmod3 linked${data.email ? ' as ' + data.email : ''}`);
        bm3.remoteLogs = null; // force refetch next time the tab opens
        await loadBootmod3Status();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

export async function unlinkBootmod3() {
    if (!confirm('Unlink your bootmod3 account? Imported logs stay in your library.')) return;
    try {
        const res = await fetch('/api/bootmod3/link', { method: 'DELETE', headers: getAuthHeaders() });
        if (!res.ok) throw new Error(`Unlink failed (${res.status})`);
        bm3.remoteLogs = null;
        bm3.selection.clear();
        showToast('bootmod3 unlinked');
        await loadBootmod3Status();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ---- Datalogs tab: remote log list + import ---------------------------------

// bootmod3's /getlogs shape isn't contractual, so pull id/name/date defensively.
function normalizeRemoteLogs(payload) {
    let arr = payload;
    if (arr && !Array.isArray(arr)) {
        arr = arr.logs || arr.data || arr.datalogs || arr.results || null;
    }
    if (!Array.isArray(arr)) return null;

    const pick = (o, keys) => {
        for (const k of keys) if (o[k] != null && o[k] !== '') return o[k];
        return null;
    };
    return arr.map((o) => {
        if (o == null || typeof o !== 'object') return { id: String(o), name: String(o), subtitle: '' };
        const id = pick(o, ['id', '_id', 'logid', 'log_id', 'logId', 'uuid']);
        const name = pick(o, ['name', 'title', 'filename', 'vehicle', 'car', 'notes', 'description']);
        const date = pick(o, ['date', 'created', 'created_at', 'createdAt', 'timestamp', 'uploaded_at']);
        return {
            id: id != null ? String(id) : null,
            name: name != null ? String(name) : (id != null ? `Log ${id}` : 'Untitled log'),
            subtitle: date != null ? String(date) : '',
        };
    }).filter((l) => l.id != null);
}

function alreadyImported(remoteId) {
    const target = `dlog_${remoteId}.csv`;
    return state.currentLogs.some((l) => l.name === target);
}

export async function refreshRemoteLogs() {
    bm3.loading = true;
    bm3.error = null;
    renderPanelInto(document.getElementById('libraryGrid'));
    try {
        const res = await fetch('/api/bootmod3/logs', { headers: getAuthHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || `Failed to load logs (${res.status})`);
        const normalized = normalizeRemoteLogs(data.logs);
        if (normalized == null) {
            bm3.remoteLogs = [];
            bm3.error = 'Could not read the bootmod3 log list format.';
        } else {
            bm3.remoteLogs = normalized;
        }
    } catch (err) {
        bm3.remoteLogs = [];
        bm3.error = err.message;
    } finally {
        bm3.loading = false;
    }
    // Drop selections for logs no longer present.
    const ids = new Set((bm3.remoteLogs || []).map((l) => l.id));
    bm3.selection.forEach((id) => { if (!ids.has(id)) bm3.selection.delete(id); });
    renderPanelInto(document.getElementById('libraryGrid'));
}

// Called by library.js when the "bootmod3" rail filter is active. Owns the
// content of #libraryGrid while that tab is selected.
export function renderBootmod3Panel(grid) {
    const title = document.getElementById('libraryActiveTitle');
    const countPill = document.getElementById('libraryActiveCount');
    const empty = document.getElementById('libraryEmpty');
    const btnDetails = document.getElementById('btnBuildDetails');
    if (btnDetails) btnDetails.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (title) title.textContent = 'bootmod3';

    // Status unknown (tab opened before Settings visited) -> load then re-render.
    if (bm3.status == null) {
        grid.innerHTML = `<div class="bm3-empty"><p>Checking bootmod3 link…</p></div>`;
        loadBootmod3Status().then(() => {
            if (state.libraryFilter === 'bootmod3') renderBootmod3Panel(grid);
        });
        return;
    }

    const linked = bm3.status && bm3.status.linked;
    if (!linked) {
        if (countPill) countPill.textContent = 0;
        grid.innerHTML = `
            <div class="bm3-empty">
                <p>No bootmod3 account linked.</p>
                <button class="btn-primary" data-scramble="true" data-action="goToBootmod3Settings">Link account</button>
            </div>`;
        return;
    }

    // Lazily load the remote list the first time the tab is shown.
    if (bm3.remoteLogs == null && !bm3.loading) {
        refreshRemoteLogs();
        return;
    }
    if (countPill) countPill.textContent = bm3.remoteLogs ? bm3.remoteLogs.length : 0;
    renderPanelInto(grid);
}

function renderPanelInto(grid) {
    if (!grid || state.libraryFilter !== 'bootmod3') return;

    const countPill = document.getElementById('libraryActiveCount');
    if (countPill) countPill.textContent = bm3.remoteLogs ? bm3.remoteLogs.length : 0;

    if (bm3.loading) {
        grid.innerHTML = `<div class="bm3-empty"><p>Loading bootmod3 logs…</p></div>`;
        return;
    }

    const logs = bm3.remoteLogs || [];
    const selectable = logs.filter((l) => !alreadyImported(l.id));

    const toolbar = `
        <div class="bm3-toolbar">
            <div class="bm3-toolbar-left">
                <button class="btn-bulk btn-bulk-secondary" data-scramble="true" data-action="refreshBootmod3Logs">Refresh</button>
                ${selectable.length ? `<button class="btn-bulk btn-bulk-secondary" data-scramble="true" data-action="toggleAllBootmod3">
                    ${bm3.selection.size >= selectable.length && selectable.length ? 'Deselect all' : 'Select all'}</button>` : ''}
            </div>
            <button class="btn-primary bm3-import-btn" data-scramble="true" data-action="importSelectedBootmod3"
                    ${bm3.selection.size ? '' : 'disabled'}>
                Import selected${bm3.selection.size ? ` (${bm3.selection.size})` : ''}
            </button>
        </div>`;

    if (bm3.error) {
        grid.innerHTML = toolbar + `<div class="bm3-empty"><p class="bm3-warn">${escapeHtml(bm3.error)}</p></div>`;
        wirePanel(grid);
        return;
    }
    if (!logs.length) {
        grid.innerHTML = toolbar + `<div class="bm3-empty"><p>No datalogs found on this bootmod3 account.</p></div>`;
        wirePanel(grid);
        return;
    }

    const rows = logs.map((l) => {
        const imported = alreadyImported(l.id);
        const checked = bm3.selection.has(l.id) ? 'checked' : '';
        const rel = timeAgo(l.subtitle) || escapeHtml(l.subtitle || '');
        return `
            <label class="bm3-row ${imported ? 'imported' : ''} ${checked ? 'selected' : ''}" data-id="${escapeHtml(l.id)}">
                <input type="checkbox" ${checked} ${imported ? 'disabled' : ''}>
                <div class="bm3-row-main">
                    <span class="bm3-row-name">${escapeHtml(l.name)}</span>
                    <span class="bm3-row-sub">ID ${escapeHtml(l.id)}${rel ? ' • ' + rel : ''}</span>
                </div>
                ${imported ? '<span class="bm3-imported-badge">Imported</span>' : ''}
            </label>`;
    }).join('');

    grid.innerHTML = toolbar + `<div class="bm3-list">${rows}</div>`;
    wirePanel(grid);
}

function wirePanel(grid) {
    grid.querySelectorAll('.bm3-row input[type="checkbox"]:not([disabled])').forEach((cb) => {
        cb.addEventListener('change', (e) => {
            const row = e.target.closest('.bm3-row');
            const id = row.dataset.id;
            if (e.target.checked) bm3.selection.add(id);
            else bm3.selection.delete(id);
            row.classList.toggle('selected', e.target.checked);
            // Update toolbar in place (re-rendering the list would drop DOM nodes
            // and break rapid multi-select / lose scroll position).
            updateToolbar(grid);
        });
    });
}

function updateToolbar(grid) {
    const n = bm3.selection.size;
    const importBtn = grid.querySelector('.bm3-import-btn');
    if (importBtn) {
        importBtn.disabled = n === 0;
        importBtn.textContent = `Import selected${n ? ` (${n})` : ''}`;
    }
    const selectAllBtn = grid.querySelector('[data-action="toggleAllBootmod3"]');
    if (selectAllBtn) {
        const selectable = (bm3.remoteLogs || []).filter((l) => !alreadyImported(l.id));
        selectAllBtn.textContent = (n >= selectable.length && selectable.length) ? 'Deselect all' : 'Select all';
    }
}

export function refreshBootmod3Logs() {
    bm3.remoteLogs = null;
    bm3.selection.clear();
    refreshRemoteLogs();
}

export function toggleAllBootmod3() {
    const selectable = (bm3.remoteLogs || []).filter((l) => !alreadyImported(l.id));
    if (bm3.selection.size >= selectable.length) bm3.selection.clear();
    else selectable.forEach((l) => bm3.selection.add(l.id));
    renderPanelInto(document.getElementById('libraryGrid'));
}

export async function importSelectedBootmod3() {
    const ids = [...bm3.selection];
    if (!ids.length) return;

    const btn = document.querySelector('.bm3-import-btn');
    if (btn) { btn.disabled = true; btn.textContent = `Importing 0/${ids.length}…`; }

    let ok = 0;
    const failures = [];
    for (const id of ids) {
        try {
            const res = await fetch('/api/bootmod3/import', {
                method: 'POST',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ log_id: id }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
            ok += 1;
        } catch (err) {
            failures.push(`${id}: ${err.message}`);
        }
        if (btn) btn.textContent = `Importing ${ok + failures.length}/${ids.length}…`;
    }

    bm3.selection.clear();
    await refreshLogList();          // pull the new local logs (updates "Imported" badges)
    renderPanelInto(document.getElementById('libraryGrid'));

    if (failures.length) {
        showToast(`Imported ${ok}/${ids.length}. ${failures.length} failed.`, 'error');
        console.warn('bootmod3 import failures:', failures);
    } else {
        showToast(`Imported ${ok} log${ok === 1 ? '' : 's'} from bootmod3`);
    }
}
