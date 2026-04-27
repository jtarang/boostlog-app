import { state } from './state.js';
import { parseJwt } from './utils.js';
import { showToast } from './toast.js';
import { refreshLogList } from './sidebar.js';

export function initAuth() {
    if (state.authToken) {
        const payload = parseJwt(state.authToken);
        if (payload && payload.sub) {
            const usernameEl = document.getElementById('navUsername');
            if (usernameEl) usernameEl.textContent = payload.sub;
        }
        document.getElementById('authOverlay').style.display = 'none';
        refreshLogList(null, true);
    } else {
        document.getElementById('authOverlay').style.display = 'flex';
        startPasskeyAutofill();
    }
}

export async function startPasskeyAutofill() {
    if (state.autofillStarted) return;
    if (!window.SimpleWebAuthnBrowser) return;
    try {
        const supported = await SimpleWebAuthnBrowser.browserSupportsWebAuthnAutofill?.();
        if (!supported) return;
    } catch { return; }
    state.autofillStarted = true;
    try {
        const optsRes = await fetch('/api/auth/webauthn/login/discoverable/options');
        if (!optsRes.ok) return;
        const optionsJSON = await optsRes.json();

        const asseResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON, useBrowserAutofill: true });

        const verifyRes = await fetch('/api/auth/webauthn/login/discoverable/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(asseResp)
        });
        const data = await verifyRes.json();
        if (verifyRes.ok && data.access_token) {
            state.authToken = data.access_token;
            localStorage.setItem('boostlog_token', state.authToken);
            location.reload();
        } else if (verifyRes.ok === false) {
            console.warn('Passkey autofill verify failed:', data.detail);
        }
    } catch (err) {
        console.debug('Passkey autofill ended:', err && err.message);
        state.autofillStarted = false;
    }
}

export function switchAuthTab(mode) {
    state.authMode = mode;
    const tabs = document.querySelectorAll('.auth-tabs .tab');
    tabs.forEach(t => t.classList.remove('active'));
    if (mode === 'login') {
        tabs[0].classList.add('active');
        document.getElementById('authSubmitBtn').textContent = 'Login';
    } else {
        tabs[1].classList.add('active');
        document.getElementById('authSubmitBtn').textContent = 'Register';
    }
    document.getElementById('authError').textContent = '';
}

export async function handleAuth(e) {
    e.preventDefault();
    const u = document.getElementById('authUsername').value;
    const p = document.getElementById('authPassword').value;
    const errorEl = document.getElementById('authError');
    errorEl.textContent = '';

    try {
        if (state.authMode === 'register') {
            const res = await fetch('/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u, password: p })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Registration failed');
            switchAuthTab('login');
            await performLogin(u, p);
        } else {
            await performLogin(u, p);
        }
    } catch (err) {
        errorEl.textContent = err.message;
    }
}

async function performLogin(username, password) {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);

    const res = await fetch('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Login failed');

    state.authToken = data.access_token;
    localStorage.setItem('boostlog_token', state.authToken);
    initAuth();
}

export async function loginAsDemo() {
    const errorEl = document.getElementById('authError');
    if (errorEl) errorEl.textContent = '';
    try {
        await performLogin('demo', 'demo');
    } catch (err) {
        if (errorEl) errorEl.textContent = "Demo mode failed: " + err.message;
    }
}

export function logout() {
    localStorage.removeItem('boostlog_token');
    window.location.reload();
}

export async function loginWithPasskey() {
    const username = document.getElementById('authUsername').value.trim();
    try {
        if (username) {
            await loginWithPasskeyForUser(username);
        } else {
            await loginWithDiscoverablePasskey();
        }
    } catch (err) {
        console.error(err);
        showToast(err.message, 'error');
    }
}

async function loginWithPasskeyForUser(username) {
    const resp = await fetch(`/api/auth/webauthn/login/options?username=${encodeURIComponent(username)}`);
    const responseText = await resp.text();
    let options;
    try { options = JSON.parse(responseText); }
    catch { throw new Error(`Server error (${resp.status}): ${responseText.substring(0, 100)}`); }
    if (!resp.ok) throw new Error(options.detail || 'Failed to get login options');

    const asseResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
    const verifyResp = await fetch(`/api/auth/webauthn/login/verify?username=${encodeURIComponent(username)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asseResp)
    });
    const data = await verifyResp.json();
    if (!verifyResp.ok) throw new Error(data.detail || 'Login failed');
    localStorage.setItem('boostlog_token', data.access_token);
    location.reload();
}

async function loginWithDiscoverablePasskey() {
    const optsRes = await fetch('/api/auth/webauthn/login/discoverable/options');
    if (!optsRes.ok) throw new Error('Failed to get login options');
    const optionsJSON = await optsRes.json();
    const asseResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON });
    const verifyRes = await fetch('/api/auth/webauthn/login/discoverable/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asseResp)
    });
    const data = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(data.detail || 'Passkey login failed');
    localStorage.setItem('boostlog_token', data.access_token);
    location.reload();
}

export function openForgotPassword() {
    document.getElementById('forgotPasswordModal').style.display = 'flex';
}

export function closeForgotPassword() {
    document.getElementById('forgotPasswordModal').style.display = 'none';
}

export async function submitForgotPassword() {
    const input = document.getElementById('forgotInput').value.trim();
    if (!input) return;
    try {
        const res = await fetch('/api/auth/reset-password/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username_or_email: input })
        });
        if (res.ok) {
            document.getElementById('forgotHint').textContent = 'Recovery check complete (see server logs in dev)';
            document.getElementById('forgotHint').style.display = 'block';
        }
    } catch (err) { showToast(err.message, 'error'); }
}

export async function submitResetPassword() {
    const newPass = document.getElementById('resetNewPass').value.trim();
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!newPass) {
        showToast('Enter a new password', 'error');
        return;
    }
    if (!token) return;

    try {
        const res = await fetch('/api/auth/reset-password/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, new_password: newPass })
        });
        if (res.ok) {
            showToast('Password reset successful. You can now login.');
            document.getElementById('resetPasswordModal').style.display = 'none';
            window.history.replaceState({}, document.title, "/");
        } else {
            const data = await res.json();
            document.getElementById('resetError').textContent = data.detail || 'Reset failed';
        }
    } catch (err) { showToast(err.message, 'error'); }
}
