// Progressive-enhancement motion layer. GSAP loads from CDN at runtime;
// if it fails (offline, blocked) the app behaves exactly as before.
// Modals & the AI drawer already animate via CSS — this module covers
// view switches, grid entrances and the FAB, which currently snap.

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export async function initMotion() {
    if (REDUCED) return;

    let gsap;
    try {
        ({ gsap } = await import('https://cdn.jsdelivr.net/npm/gsap@3.13.0/+esm'));
    } catch (e) {
        return;
    }

    const visible = (el) => el && el.style.display !== 'none' && el.offsetParent !== null;

    // ── View switches: fade/slide the section that just became visible ──
    const views = [
        document.querySelector('.dashboard-grid'),
        document.getElementById('libraryView'),
        document.getElementById('buildsView'),
        document.getElementById('settingsView'),
    ].filter(Boolean);

    views.forEach((section) => {
        let wasVisible = visible(section);
        new MutationObserver(() => {
            const nowVisible = visible(section);
            if (nowVisible && !wasVisible) {
                gsap.fromTo(section,
                    { autoAlpha: 0, y: 10 },
                    { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power2.out', clearProps: 'all' });
            }
            wasVisible = nowVisible;
        }).observe(section, { attributes: true, attributeFilter: ['style'] });
    });

    // ── Grid entrances: stagger cards as render functions inject them ──
    const staggerGrid = (el, childSel) => {
        if (!el) return;
        let pending = [];
        let raf = null;

        new MutationObserver((mutations) => {
            mutations.forEach(m => m.addedNodes.forEach(n => {
                if (n.nodeType === 1 && n.matches(childSel)) pending.push(n);
            }));
            if (pending.length && !raf) {
                raf = requestAnimationFrame(() => {
                    const batch = pending.slice(0, 24); // cap so huge libraries stay snappy
                    pending = [];
                    raf = null;
                    gsap.fromTo(batch,
                        { autoAlpha: 0, y: 14 },
                        {
                            autoAlpha: 1, y: 0, duration: 0.34, stagger: 0.035,
                            ease: 'power2.out', clearProps: 'all', overwrite: true,
                        });
                });
            }
        }).observe(el, { childList: true });
    };

    staggerGrid(document.getElementById('libraryGrid'), '.log-card');
    staggerGrid(document.getElementById('buildsGrid'), '*');
    staggerGrid(document.getElementById('logItems'), 'li');

    // ── FAB: pop in the moment a log makes it usable ──
    const fab = document.getElementById('fabAi');
    if (fab) {
        new MutationObserver(() => {
            if (!fab.disabled) {
                gsap.fromTo(fab,
                    { scale: 0.4, rotation: -12, autoAlpha: 0 },
                    { scale: 1, rotation: 0, autoAlpha: 1, duration: 0.55, ease: 'back.out(2.2)', overwrite: true });
            }
        }).observe(fab, { attributes: true, attributeFilter: ['disabled'] });
    }
}
