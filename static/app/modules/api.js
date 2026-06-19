// Single source of truth for the backend origin.
//
// On the web / installed PWA the app is served from the same origin as the API,
// so the base is empty and all the existing relative calls ("/api/...", "/token")
// just work. The native (Capacitor) build loads the UI from capacitor://localhost,
// so it must point these calls at the deployed backend — it does that by setting
// `window.BOOSTLOG_API_BASE` before the app boots.
//
// Rather than touch ~30 call sites, we transparently rewrite the app's own
// relative API requests through the base here, once, at startup.
export const API_BASE = (window.BOOSTLOG_API_BASE || '').replace(/\/$/, '');

const OWNED_PATH = /^\/(api|token|register)\b/;
const nativeFetch = window.fetch.bind(window);

window.fetch = (input, init) => {
    if (API_BASE && typeof input === 'string' && OWNED_PATH.test(input)) {
        input = API_BASE + input;
    }
    return nativeFetch(input, init);
};
