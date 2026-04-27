import { getAuthHeaders, escapeHtml } from './utils.js';
import { showToast } from './toast.js';
import { openRenameModal, openConfirmDeleteModal } from './modals.js';

export async function loadUserSettings() {
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
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;">
                    <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
                        <span style="font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis;">🔑 ${escapeHtml(p.name)}</span>
                        ${meta ? `<span style="color: var(--text-secondary); font-size: 11px;">${escapeHtml(meta)}</span>` : ''}
                    </div>
                    <div style="display: flex; gap: 6px;">
                        <button class="btn-secondary" data-action="renamePasskey" data-id="${p.id}" data-name="${escapeHtml(p.name)}" style="padding: 4px 10px; font-size: 11px; background: transparent; border: 1px solid rgba(255,255,255,0.15); color: var(--text-secondary);">Rename</button>
                        <button class="btn-secondary" data-action="deletePasskey" data-id="${p.id}" data-name="${escapeHtml(p.name)}" style="padding: 4px 10px; font-size: 11px; background: transparent; border: 1px solid rgba(255,255,255,0.15); color: var(--text-secondary);">Remove</button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Failed to load passkeys:', err);
    }
}

export function renamePasskey(id, currentName) {
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

export function deletePasskey(id, name) {
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

export async function saveUserSettings() {
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

export function registerPasskey() {
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

export async function updateUsername() {
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
