import { getAuthHeaders } from './utils.js';
import { showToast } from './toast.js';

let stripe = null;
let cardElement = null;
let addCardElement = null;

export async function initializeStripe(publishableKey) {
    if (!publishableKey) {
        console.warn('Stripe publishable key not configured');
        return;
    }

    stripe = Stripe(publishableKey);
    const elements = stripe.elements();

    const cardStyle = {
        style: {
            base: {
                color: '#fff',
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: '14px',
                fontSmoothing: 'antialiased',
                '::placeholder': { color: 'rgba(255,255,255,0.5)' }
            },
            invalid: { color: '#ff006e', iconColor: '#ff006e' }
        }
    };

    const cardElementDiv = document.getElementById('card-element');
    if (cardElementDiv) {
        cardElement = elements.create('card', cardStyle);
        cardElement.mount('#card-element');
        cardElement.addEventListener('change', (event) => {
            const el = document.getElementById('upgradeError');
            if (el) el.textContent = event.error ? event.error.message : '';
        });
    }

    const addCardDiv = document.getElementById('add-card-element');
    if (addCardDiv) {
        addCardElement = elements.create('card', cardStyle);
        addCardElement.mount('#add-card-element');
        addCardElement.addEventListener('change', (event) => {
            const el = document.getElementById('addCardError');
            if (el) el.textContent = event.error ? event.error.message : '';
        });
    }
}

export async function createNewPaymentMethod(cardEl, errorElId) {
    if (!stripe || !cardEl) {
        showToast('Stripe not initialized', 'error');
        return null;
    }

    const { paymentMethod, error } = await stripe.createPaymentMethod({ type: 'card', card: cardEl });

    if (error) {
        const el = document.getElementById(errorElId);
        if (el) el.textContent = error.message;
        return null;
    }

    return paymentMethod.id;
}

export async function saveNewCard() {
    const pmId = await createNewPaymentMethod(addCardElement, 'addCardError');
    if (!pmId) return false;

    try {
        const res = await fetch('/api/user/subscription/create-payment-intent', {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier: '_save_only', payment_method_id: pmId, save_only: true })
        });

        if (res.status === 400) {
            // Use dedicated save endpoint instead
            const saveRes = await fetch('/api/user/payment-methods/save', {
                method: 'POST',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ payment_method_id: pmId })
            });
            return saveRes.ok;
        }
        return res.ok;
    } catch {
        return false;
    }
}

export async function submitStripePayment(tier, price, existingPaymentMethodId = null) {
    const displayError = document.getElementById('upgradeError');
    if (displayError) displayError.textContent = '';

    let paymentMethodId = existingPaymentMethodId;

    if (!paymentMethodId) {
        paymentMethodId = await createNewPaymentMethod(cardElement, 'upgradeError');
        if (!paymentMethodId) return { success: false };
    }

    try {
        const res = await fetch('/api/user/subscription/create-payment-intent', {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier, payment_method_id: paymentMethodId })
        });

        const data = await res.json();

        if (!res.ok) {
            if (displayError) displayError.textContent = data.detail || 'Payment failed';
            return { success: false, error: data.detail };
        }

        // SCA / 3-D Secure: the subscription is created 'incomplete' and hands
        // back a PaymentIntent client_secret. Confirming it here triggers the
        // bank's 3-D Secure challenge when required; for cards that don't need
        // it, confirmation completes the charge immediately.
        if (data.client_secret) {
            const { error: confirmError } = await stripe.confirmCardPayment(data.client_secret, {
                payment_method: paymentMethodId,
            });
            if (confirmError) {
                if (displayError) displayError.textContent = confirmError.message;
                return { success: false, error: confirmError.message };
            }
            // Payment authenticated & captured — reconcile entitlement now
            // rather than waiting on the webhook.
            const syncRes = await fetch('/api/user/subscription/sync', {
                method: 'POST',
                headers: getAuthHeaders(),
            });
            if (!syncRes.ok) {
                // The charge succeeded; only the immediate reconciliation failed.
                // The webhook is the source of truth and will finish the upgrade.
                showToast('Payment received — finalizing your upgrade…');
                return { success: true, tier };
            }
        } else if (data.requires_action) {
            // Backend says confirmation is needed but gave us nothing to confirm
            // with — do not report success (the tier was not granted).
            const msg = 'We could not start card authentication. Please try again.';
            if (displayError) displayError.textContent = msg;
            return { success: false, error: msg };
        }

        showToast(`Successfully upgraded to ${tier}!`);
        return { success: true, tier };
    } catch (err) {
        if (displayError) displayError.textContent = err.message;
        return { success: false, error: err.message };
    }
}

export function getAddCardElement() {
    return addCardElement;
}
