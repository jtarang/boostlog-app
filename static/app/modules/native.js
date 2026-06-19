// Native (Capacitor) integration. No-op on web/PWA.
//
// The only native-specific concern today is GitHub OAuth: opening github.com
// inside the app webview is fragile and discouraged by providers/app stores, so
// on native we route it through the system browser and return to the app via a
// boostlog:// deep link (handled below).
const cap = window.Capacitor;
export const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());

export function initNative() {
    if (!isNative) return;
    const { Browser, App } = cap.Plugins;

    // Open the GitHub login in the system browser instead of navigating the
    // webview to github.com.
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href="/api/auth/github/login"]');
        if (!link) return;
        e.preventDefault();
        Browser.open({ url: `${location.origin}/api/auth/github/login?native=1` });
    });

    // Return from OAuth: boostlog://auth/github?token=<jwt>
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
