// Native (Capacitor) integration. No-op on web/PWA.
//
// OAuth providers block/ discourage sign-in inside an app webview, so on native
// we route EVERY provider's login through the system browser and return to the
// app via a boostlog:// deep link (handled below). The backend, when it sees
// native=1, redirects the callback to boostlog://auth/<provider>?token=<jwt>.
const cap = window.Capacitor;
export const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());

export function initNative() {
    if (!isNative) return;
    const { Browser, App } = cap.Plugins;

    // Intercept any provider login link (/api/auth/<provider>/login) and open it
    // in the system browser with native=1 instead of navigating the webview.
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href^="/api/auth/"][href$="/login"]');
        if (!link) return;
        e.preventDefault();
        const href = link.getAttribute('href');
        const sep = href.includes('?') ? '&' : '?';
        Browser.open({ url: `${location.origin}${href}${sep}native=1` });
    });

    // Return from OAuth: boostlog://auth/<provider>?token=<jwt>
    App.addListener('appUrlOpen', ({ url }) => {
        let token = null;
        try {
            token = new URL(url).searchParams.get('token');
        } catch (_) {
            return;
        }
        if (!token) return;
        localStorage.setItem('boostlog_token', token);
        Browser.close();
        location.href = '/app';
    });
}
