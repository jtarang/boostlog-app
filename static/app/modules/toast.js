export function showToast(message, type = 'success', duration = 4000) {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-msg">${message}</span>
        <button class="toast-close">✕</button>
    `;
    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    const timeout = duration || 3000;
    setTimeout(() => {
        if (toast && toast.parentElement) {
            toast.classList.remove('toast-visible');
            setTimeout(() => toast.remove(), 400);
        }
    }, timeout);
}
