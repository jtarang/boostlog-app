const TWEAK_DEFAULTS = {
    "accent": "blue",
    "density": "comfortable",
    "showBadge": true
};

export function initTweaks() {
    const tweaksPanel = document.getElementById('tweaksPanel');
    if (!tweaksPanel) return;

    let state = { ...TWEAK_DEFAULTS, ...JSON.parse(localStorage.getItem('bl_tweaks') || '{}') };

    const save = () => {
        localStorage.setItem('bl_tweaks', JSON.stringify(state));
        apply();
    };

    const apply = () => {
        document.documentElement.setAttribute('data-accent', state.accent);
        document.documentElement.setAttribute('data-density', state.density);
        document.body.classList.toggle('hide-badges', !state.showBadge);

        // Update UI
        tweaksPanel.querySelectorAll('.tweak-opt').forEach(opt => {
            const val = opt.dataset.value;
            const key = opt.dataset.key;
            opt.classList.toggle('active', state[key] === val);
        });

        const badgeToggle = tweaksPanel.querySelector('.toggle-switch');
        if (badgeToggle) badgeToggle.classList.toggle('on', state.showBadge);
    };

    tweaksPanel.addEventListener('click', (e) => {
        const opt = e.target.closest('.tweak-opt');
        if (opt) {
            state[opt.dataset.key] = opt.dataset.value;
            save();
            return;
        }

        const toggle = e.target.closest('.toggle-switch');
        if (toggle) {
            state.showBadge = !state.showBadge;
            save();
        }
    });

    // Keyboard shortcut to toggle panel
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'j') {
            tweaksPanel.classList.toggle('active');
        }
    });

    apply();
}
