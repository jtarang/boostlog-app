import { state } from './state.js';

export function getAuthHeaders() {
    return state.authToken ? { 'Authorization': `Bearer ${state.authToken}` } : {};
}

// Put a button into a disabled "processing" state (inline spinner + optional
// label) and return a restore() that puts back the exact original content.
// Freezes the button width so the layout doesn't jump. Guard against
// double-clicks. Safe with a missing element (returns a no-op).
export function setButtonLoading(btn, label = 'Processing…') {
    if (!btn || btn.dataset.loading === '1') return () => {};
    const original = btn.innerHTML;
    const width = btn.offsetWidth;
    btn.dataset.loading = '1';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (width) btn.style.minWidth = `${width}px`;
    btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span>${label ? `<span>${label}</span>` : ''}`;
    return () => {
        btn.innerHTML = original;
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        btn.style.minWidth = '';
        delete btn.dataset.loading;
    };
}

// Wrap an async action so `btn` shows the loading state for its whole duration
// and is always restored afterwards (even if it throws).
export async function withButtonLoading(btn, label, fn) {
    const restore = setButtonLoading(btn, label);
    try {
        return await fn();
    } finally {
        restore();
    }
}

export async function downloadFile(url, filename) {
    try {
        const response = await fetch(url, {
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Download failed');
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename || 'log.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
        console.error('Download error:', err);
        alert('Failed to download file. Please try again.');
    }
}

export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

export function timeAgo(isoStr) {
    if (!isoStr) return null;
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(isoStr).toLocaleDateString();
}
