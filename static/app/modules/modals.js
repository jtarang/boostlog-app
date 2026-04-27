import { state } from './state.js';
import { getAuthHeaders } from './utils.js';
import { showToast } from './toast.js';
import { refreshLogList } from './sidebar.js';

export function openRenameModal({ title = 'Rename', label = '', placeholder = '', currentName = '', confirmText = 'Save Changes', onSave }) {
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
    state.renameOnSave = onSave;

    modal.style.display = 'flex';
    setTimeout(() => { input.focus(); input.select(); }, 0);
}

export function closeRenameModal() {
    const modal = document.getElementById('renameModal');
    if (modal) modal.style.display = 'none';
    state.renameOnSave = null;
}

export async function submitRename() {
    const input = document.getElementById('renameInput');
    const newName = input ? input.value.trim() : '';
    if (!newName || !state.renameOnSave) return;

    const handler = state.renameOnSave;
    closeRenameModal();
    try {
        await handler(newName);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

export async function renameLog(logId, currentName) {
    openRenameModal({
        title: 'Rename Log',
        label: 'Enter a new descriptive name for your datalog.',
        placeholder: 'Log Name',
        currentName,
        onSave: (newName) => submitLogRename(logId, newName)
    });
}

async function submitLogRename(logId, newName) {
    try {
        const res = await fetch(`/api/logs/${logId}/rename`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_name: newName })
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.detail || 'Failed to rename log');
        }

        if (state.currentLogId === logId) {
            const title = document.getElementById('pageTitle');
            if (title) title.textContent = newName;
        }

        showToast('Log renamed successfully');
        refreshLogList();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

export function openConfirmDeleteModal({ title = 'Confirm Delete', subtitle = '', body = '', confirmText = 'Permanently Delete', onConfirm }) {
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

export function closeDeleteModal() {
    document.getElementById('deleteConfirmModal').style.display = 'none';
}
