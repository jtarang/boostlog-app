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

    // Return from OAuth: boostlog://auth/<provider>?token=<jwt> on success, or
    // ?error=<message> on failure (expired/denied/etc.).
    App.addListener('appUrlOpen', ({ url }) => {
        let params;
        try {
            params = new URL(url).searchParams;
        } catch (_) {
            return;
        }
        const token = params.get('token');
        const error = params.get('error');
        if (token) {
            localStorage.setItem('boostlog_token', token);
            Browser.close();
            location.href = '/app';
        } else if (error) {
            Browser.close();
            // Reuse the login page's auth_error handling to show the message.
            location.href = '/app?auth_error=' + encodeURIComponent(error);
        }
    });
}
