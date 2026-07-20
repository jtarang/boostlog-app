import { state } from './state.js';
import { getAuthHeaders, escapeHtml, setButtonLoading } from './utils.js';
import { showToast } from './toast.js';
import { openRenameModal, openConfirmDeleteModal } from './modals.js';
import { initializeStripe, submitStripePayment } from './stripe.js';

// The email on file for the current user. GitHub-login users start without one,
// and must add it (openEmailRequiredModal) before they can subscribe.
let userEmail = '';
let pendingUpgradeEl = null;
import { loadBootmod3Status } from './bootmod3.js';
import { getAxisMode, setAxisMode } from './chart.js';
import { getMetricsConfig, saveMetricsConfig, renderMetricTiles, calculateMetrics } from './metrics.js';

// Serialize the full settings object to the account. The backend replaces
// settings_json wholesale, so we always send every key we own, merged onto the
// cached copy loaded at sign-in (state.userSettings). Fired on explicit saves
// and whenever a decoupled part (e.g. the metrics editor) emits 'settingschanged'.
async function persistSettings() {
    state.userSettings = {
        ...(state.userSettings || {}),
        graph_mode: getAxisMode(),
        session_metrics: getMetricsConfig(),
    };
    try {
        await fetch('/api/user/me', {
            method: 'PATCH',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings_json: JSON.stringify(state.userSettings) }),
        });
    } catch (err) {
        console.error('Failed to sync settings to account:', err);
    }
}

window.addEventListener('settingschanged', persistSettings);

// Map graph_mode to the current axis-mode vocabulary. The old select
// ("single"/"multi") was never actually applied to the chart, so there's no
// legacy behavior to preserve — only "multi" needs remapping; "single" now
// carries its new meaning (one shared axis).
function normalizeGraphMode(v) {
    if (v === 'multi') return 'independent';         // old "Multiple Overlay"
    if (['grouped', 'single', 'independent'].includes(v)) return v;
    return 'grouped';
}

export async function loadUserSettings() {
    console.log('loadUserSettings called');
    try {
        const res = await fetch('/api/user/me', { headers: getAuthHeaders() });
        const data = await res.json();
        console.log('User data:', data);
        if (res.ok) {
            document.getElementById('setFullName').value = data.full_name || '';
            document.getElementById('setEmail').value = data.email || '';
            userEmail = data.email || '';
            if (data.settings) {
                // Cache the account settings so later writes merge onto them
                // (the backend replaces settings_json wholesale).
                state.userSettings = { ...data.settings };

                document.getElementById('setUnits').value = data.settings.units || 'metric';
                // Seed the local axis-mode store from the account on first load
                // (e.g. a fresh device), then reflect it in the dropdown.
                if (data.settings.graph_mode && !localStorage.getItem('boostlog_axis_mode')) {
                    setAxisMode(normalizeGraphMode(data.settings.graph_mode));
                }
                document.getElementById('setGraphMode').value = getAxisMode();

                // Session-metric config is account-authoritative: every edit is
                // pushed to the account, so on load the account wins.
                if (Array.isArray(data.settings.session_metrics) && data.settings.session_metrics.length) {
                    saveMetricsConfig(data.settings.session_metrics);
                    renderMetricTiles();
                    if (state.currentData) calculateMetrics();
                }
            }
            console.log('Calling loadSubscriptionInfo with tier:', data.subscription_tier);
            loadSubscriptionInfo(data.subscription_tier);

            // Initialize Stripe.js with the publishable key so card fields can mount.
            try {
                const stripeRes = await fetch('/api/stripe/config', { headers: getAuthHeaders() });
                const stripeConfig = await stripeRes.json();
                if (stripeConfig.publishable_key) {
                    initializeStripe(stripeConfig.publishable_key);
                }
            } catch (err) {
                console.warn('Failed to initialize Stripe:', err);
            }
        }
    } catch (err) { console.error('Failed to load settings:', err); }
    loadPasskeys();
    loadBootmod3Status();
    loadPaymentMethods();
}

export async function loadSubscriptionInfo(currentTier) {
    try {
        const res = await fetch('/api/user/usage', { headers: getAuthHeaders() });
        const data = await res.json();
        if (res.ok) {
            const { used, limit, tier, cancel_at_period_end, access_until } = data;
            const percentage = (used / limit) * 100;

            document.getElementById('currentTierBadge').textContent = tier.charAt(0).toUpperCase() + tier.slice(1);
            document.getElementById('usageLabel').textContent = `${used.toLocaleString()} / ${limit.toLocaleString()}`;
            document.getElementById('usageBarFill').style.width = Math.min(percentage, 100) + '%';

            const priceMap = { free: '$0', pro: '$14', tuner: '$29' };
            document.getElementById('tierPriceLabel').textContent = `${priceMap[tier]}/month`;

            // Reactivate button — shown only while a cancellation is pending.
            const reactivateBtn = document.getElementById('reactivateSubBtn');
            if (reactivateBtn) reactivateBtn.style.display = cancel_at_period_end ? 'inline-block' : 'none';

            // Cancellation notice — shown when the subscription is set to lapse at period end.
            let notice = document.getElementById('cancelNotice');
            if (cancel_at_period_end) {
                const untilText = access_until
                    ? `Cancels on ${new Date(access_until).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Access continues until then.`
                    : 'Scheduled to cancel at the end of the billing period.';
                if (!notice) {
                    notice = document.createElement('p');
                    notice.id = 'cancelNotice';
                    notice.style.cssText = 'font-size:12px; color:#FF9F1C; margin-top:8px; margin-bottom:0;';
                    document.getElementById('currentTierBadge').closest('div').appendChild(notice);
                }
                notice.textContent = untilText;
            } else if (notice) {
                notice.remove();
            }

            const tierRank = { free: 0, pro: 1, tuner: 2 };
            const rank = tierRank[tier] ?? 0;

            // Free card — hide downgrade when already cancelling (no need to double-cancel).
            document.getElementById('upgradeFreeBut').style.display = tier === 'free' ? 'block' : 'none';
            document.getElementById('downgradeFreeBut').style.display = (tier !== 'free' && !cancel_at_period_end) ? 'block' : 'none';

            // Pro card.
            const proIsCurrent = tier === 'pro' && !cancel_at_period_end;
            document.getElementById('upgradeProBut').style.display = proIsCurrent ? 'block' : 'none';
            document.getElementById('upgradeProUpBtn').style.display = tier !== 'pro' || cancel_at_period_end ? 'block' : 'none';
            document.getElementById('upgradeProUpBtn').textContent = rank < 1 ? 'Upgrade' : (cancel_at_period_end ? 'Switch' : 'Downgrade');

            // Tuner card.
            const tunerIsCurrent = tier === 'tuner' && !cancel_at_period_end;
            document.getElementById('upgradeTunerBut').style.display = tunerIsCurrent ? 'block' : 'none';
            document.getElementById('upgradeTunerUpBtn').style.display = tier !== 'tuner' || cancel_at_period_end ? 'block' : 'none';
            document.getElementById('upgradeTunerUpBtn').textContent = rank < 2 ? 'Upgrade' : (cancel_at_period_end ? 'Switch' : 'Downgrade');
        } else {
            console.error('Usage API returned non-OK status:', res.status, data);
        }
    } catch (err) { console.error('Failed to load subscription info:', err); }
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
                        <span style="font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px; overflow: hidden;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="7.5" cy="15.5" r="5.5"></circle><path d="m21 2-9.6 9.6"></path><path d="m15.5 7.5 3 3L22 7l-3-3"></path></svg><span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(p.name)}</span></span>
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
    // Apply the chosen axis mode locally (updates the inline toggle + redraws),
    // then persist the full settings object (merged onto the cached copy so we
    // don't drop keys the backend would otherwise overwrite, e.g. metrics).
    const graphMode = normalizeGraphMode(document.getElementById('setGraphMode').value);
    setAxisMode(graphMode);

    state.userSettings = {
        ...(state.userSettings || {}),
        units: document.getElementById('setUnits').value,
        graph_mode: graphMode,
        session_metrics: getMetricsConfig(),
    };

    const payload = {
        full_name: document.getElementById('setFullName').value.trim(),
        email: document.getElementById('setEmail').value.trim(),
        settings_json: JSON.stringify(state.userSettings)
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

// === Payment methods ===

let selectedPaymentMethodId = null;
let cachedPaymentMethods = [];

export async function loadPaymentMethods() {
    const list = document.getElementById('paymentMethodList');
    if (!list) return;
    try {
        const res = await fetch('/api/user/payment-methods', { headers: getAuthHeaders() });
        if (!res.ok) return;
        cachedPaymentMethods = await res.json();
        renderPaymentMethodList(list);
    } catch (err) {
        console.error('Failed to load payment methods:', err);
    }
}

function renderPaymentMethodList(container) {
    if (!cachedPaymentMethods.length) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-style: italic; font-size: 12px;">No saved cards.</div>';
        return;
    }
    container.innerHTML = cachedPaymentMethods.map(pm => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;">
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 18px;">${cardBrandIcon(pm.card_brand)}</span>
                <div>
                    <span style="font-weight: 600; font-size: 13px; color: var(--text-primary);">•••• ${escapeHtml(pm.card_last_four)}</span>
                    <span style="font-size: 11px; color: var(--text-secondary); margin-left: 8px;">${escapeHtml(pm.card_brand)} · ${pm.exp_month}/${pm.exp_year}</span>
                    ${pm.is_default ? '<span style="margin-left: 8px; font-size: 10px; background: rgba(131,56,236,0.2); color: var(--accent); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(131,56,236,0.3);">Default</span>' : ''}
                </div>
            </div>
            <div style="display: flex; gap: 6px;">
                ${!pm.is_default ? `<button class="btn-secondary" data-action="setDefaultPaymentMethod" data-id="${pm.id}" style="padding: 4px 10px; font-size: 11px; background: transparent; border: 1px solid rgba(255,255,255,0.15); color: var(--text-secondary);">Set Default</button>` : ''}
                <button class="btn-secondary" data-action="deletePaymentMethod" data-id="${pm.id}" data-last-four="${escapeHtml(pm.card_last_four)}" style="padding: 4px 10px; font-size: 11px; background: transparent; border: 1px solid rgba(255,255,255,0.15); color: var(--text-secondary);">Remove</button>
            </div>
        </div>
    `).join('');
}

function cardBrandIcon(brand) {
    const icons = { VISA: '💳', MASTERCARD: '💳', AMEX: '💳', DISCOVER: '💳' };
    return icons[brand?.toUpperCase()] || '💳';
}

export function deletePaymentMethod(id, lastFour) {
    openConfirmDeleteModal({
        title: 'Remove Card',
        subtitle: 'This card will be removed from your account.',
        body: `Are you sure you want to remove the card ending in <strong>${escapeHtml(lastFour)}</strong>?`,
        confirmText: 'Remove Card',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/user/payment-methods/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
                if (res.ok) {
                    showToast('Card removed');
                    loadPaymentMethods();
                } else {
                    const err = await res.json().catch(() => ({}));
                    showToast(err.detail || 'Failed to remove card', 'error');
                }
            } catch (err) { showToast(err.message, 'error'); }
        }
    });
}

export async function setDefaultPaymentMethod(id, btn) {
    const restore = setButtonLoading(btn, 'Saving…');
    try {
        const res = await fetch(`/api/user/payment-methods/${id}/set-default`, { method: 'POST', headers: getAuthHeaders() });
        if (res.ok) {
            showToast('Default card updated');
            loadPaymentMethods();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || 'Failed to update default', 'error');
        }
    } catch (err) { showToast(err.message, 'error'); } finally { restore(); }
}

export function openAddCardModal() {
    document.getElementById('addCardModal').style.display = 'flex';
    document.getElementById('addCardError').textContent = '';
}

export function closeAddCardModal() {
    document.getElementById('addCardModal').style.display = 'none';
}

export async function submitAddCard(btn) {
    const { getAddCardElement, createNewPaymentMethod } = await import('./stripe.js');
    const addCardEl = getAddCardElement();
    if (!addCardEl) { showToast('Card input not ready', 'error'); return; }

    const restore = setButtonLoading(btn, 'Saving…');
    try {
        const pmId = await createNewPaymentMethod(addCardEl, 'addCardError');
        if (!pmId) return;

        const res = await fetch('/api/user/payment-methods/save', {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ payment_method_id: pmId, tier: '' })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Card saved');
            closeAddCardModal();
            loadPaymentMethods();
        } else {
            document.getElementById('addCardError').textContent = data.detail || 'Failed to save card';
        }
    } catch (err) {
        document.getElementById('addCardError').textContent = err.message;
    } finally {
        restore();
    }
}

// === Upgrade / downgrade ===

let targetUpgradeTier = null;
let targetUpgradePrice = null;

export function openEmailRequiredModal() {
    document.getElementById('emailRequiredError').textContent = '';
    document.getElementById('emailRequiredInput').value = '';
    document.getElementById('emailRequiredModal').style.display = 'flex';
}

export function closeEmailRequiredModal() {
    document.getElementById('emailRequiredModal').style.display = 'none';
    pendingUpgradeEl = null;
}

export async function submitAccountEmail() {
    const errEl = document.getElementById('emailRequiredError');
    const email = document.getElementById('emailRequiredInput').value.trim();
    errEl.textContent = '';
    if (!email) { errEl.textContent = 'Please enter an email address.'; return; }
    try {
        const res = await fetch('/api/user/me', {
            method: 'PATCH',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            errEl.textContent = typeof data.detail === 'string' ? data.detail : 'Please enter a valid email.';
            return;
        }
        userEmail = email;
        document.getElementById('setEmail').value = email;
        const el = pendingUpgradeEl;
        closeEmailRequiredModal();
        showToast('Email saved');
        if (el) openUpgradeModal(el);  // resume the upgrade the user intended
    } catch (err) {
        errEl.textContent = err.message;
    }
}

export function openUpgradeModal(el) {
    // Billing requires an email (receipts + Stripe customer). GitHub users may
    // not have one yet — gate the upgrade behind adding it first.
    if (!userEmail) {
        pendingUpgradeEl = el;
        openEmailRequiredModal();
        return;
    }

    const tier = el.getAttribute('data-tier');
    const price = el.getAttribute('data-price');

    targetUpgradeTier = tier;
    targetUpgradePrice = price;
    selectedPaymentMethodId = null;

    const tierRank = { free: 0, pro: 1, tuner: 2 };
    const tierLabels = { free: 'Free', pro: 'Pro', tuner: 'Tuner' };
    const currentRank = tierRank[document.getElementById('currentTierBadge').textContent.toLowerCase()] ?? 0;
    const action = tierRank[tier] >= currentRank ? 'Upgrade' : 'Downgrade';
    document.getElementById('upgradeModalTitle').textContent = `${action} to ${tierLabels[tier]}`;
    document.getElementById('upgradeModalPlan').textContent = tierLabels[tier];
    document.getElementById('upgradeModalPrice').textContent = `$${price}`;
    document.getElementById('upgradeError').textContent = '';

    const savedCardsSection = document.getElementById('savedCardsSection');
    const newCardSection = document.getElementById('newCardSection');
    const savedCardsList = document.getElementById('savedCardsList');

    if (cachedPaymentMethods.length > 0) {
        savedCardsSection.style.display = 'block';
        newCardSection.style.display = 'none';

        const defaultPm = cachedPaymentMethods.find(pm => pm.is_default) || cachedPaymentMethods[0];
        selectedPaymentMethodId = defaultPm.stripe_payment_method_id;

        savedCardsList.innerHTML = cachedPaymentMethods.map(pm => `
            <label style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: rgba(255,255,255,0.03); border: 1px solid ${pm.stripe_payment_method_id === selectedPaymentMethodId ? 'var(--accent)' : 'rgba(255,255,255,0.08)'}; border-radius: 6px; cursor: pointer;">
                <input type="radio" name="savedCard" value="${pm.stripe_payment_method_id}" ${pm.stripe_payment_method_id === selectedPaymentMethodId ? 'checked' : ''} style="accent-color: var(--accent);">
                <span style="font-size: 18px;">${cardBrandIcon(pm.card_brand)}</span>
                <div>
                    <span style="font-weight: 600; font-size: 13px; color: var(--text-primary);">•••• ${escapeHtml(pm.card_last_four)}</span>
                    <span style="font-size: 11px; color: var(--text-secondary); margin-left: 8px;">${escapeHtml(pm.card_brand)} · ${pm.exp_month}/${pm.exp_year}</span>
                </div>
            </label>
        `).join('');

        savedCardsList.querySelectorAll('input[name="savedCard"]').forEach(radio => {
            radio.addEventListener('change', () => {
                selectedPaymentMethodId = radio.value;
                savedCardsList.querySelectorAll('label').forEach(l => {
                    l.style.borderColor = l.querySelector('input').value === selectedPaymentMethodId ? 'var(--accent)' : 'rgba(255,255,255,0.08)';
                });
            });
        });
    } else {
        savedCardsSection.style.display = 'none';
        newCardSection.style.display = 'block';
    }

    document.getElementById('upgradeModal').style.display = 'flex';
}

export function closeUpgradeModal() {
    document.getElementById('upgradeModal').style.display = 'none';
    targetUpgradeTier = null;
    targetUpgradePrice = null;
}

export function toggleNewCardForm() {
    const newCardSection = document.getElementById('newCardSection');
    const btn = document.getElementById('btnUseNewCard');
    const isHidden = newCardSection.style.display === 'none';
    newCardSection.style.display = isHidden ? 'block' : 'none';
    btn.textContent = isHidden ? 'Use a saved card' : 'Use a different card';
    if (isHidden) selectedPaymentMethodId = null;
    else {
        const defaultPm = cachedPaymentMethods.find(pm => pm.is_default) || cachedPaymentMethods[0];
        if (defaultPm) {
            selectedPaymentMethodId = defaultPm.stripe_payment_method_id;
            const radio = document.querySelector(`input[name="savedCard"][value="${selectedPaymentMethodId}"]`);
            if (radio) radio.checked = true;
        }
    }
}

export async function submitUpgrade(btn) {
    if (!targetUpgradeTier) return;

    const newCardSection = document.getElementById('newCardSection');
    const usingNewCard = newCardSection && newCardSection.style.display !== 'none';
    const pmId = usingNewCard ? null : selectedPaymentMethodId;

    // Covers the whole flow: tokenizing the card, creating the subscription, the
    // 3-D Secure challenge, and the entitlement sync — which can take seconds.
    const restore = setButtonLoading(btn, 'Processing…');
    let result;
    try {
        result = await submitStripePayment(targetUpgradeTier, targetUpgradePrice, pmId);
    } finally {
        restore();
    }

    if (result && result.success) {
        closeUpgradeModal();
        loadUserSettings();
    }
}

export async function reactivateSubscription(btn) {
    const restore = setButtonLoading(btn, 'Reactivating…');
    try {
        const res = await fetch('/api/user/subscription/reactivate', {
            method: 'POST',
            headers: getAuthHeaders(),
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Subscription reactivated');
            loadUserSettings();
        } else {
            showToast(data.detail || 'Failed to reactivate', 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        restore();
    }
}

export async function downgradeToFree(btn) {
    const restore = setButtonLoading(btn, 'Processing…');
    try {
        const res = await fetch('/api/user/subscription/upgrade', {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier: 'free' })
        });

        const data = await res.json();
        if (res.ok) {
            if (data.immediate) {
                showToast('Downgraded to Free plan');
            } else if (data.access_until) {
                // access_until is an ISO-8601 string from the backend, not epoch seconds.
                const untilDate = new Date(data.access_until).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                showToast(`Scheduled to downgrade on ${untilDate}. You keep access until then.`);
            } else {
                showToast('Downgrade scheduled for end of billing period');
            }
            loadUserSettings();
        } else {
            showToast(data.detail || 'Downgrade failed', 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        restore();
    }
}
