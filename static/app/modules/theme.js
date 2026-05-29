// Appearance: two independent axes, both persisted to localStorage and applied
// to <html> (data-theme = light/dark, data-palette = brand colors). A small
// inline script in index.html applies both before first paint (no flash);
// this module syncs the controls and broadcasts changes so the canvas redraws.
const THEME_KEY = 'bl_theme';
const PALETTE_KEY = 'bl_palette';
const VALID_PALETTES = ['original', 'blue', 'violet', 'graphite'];

function updateIcons(theme) {
    document.querySelectorAll('[data-theme-icon]').forEach(el => {
        el.style.display = el.dataset.themeIcon === theme ? '' : 'none';
    });
}

function updatePaletteUI(palette) {
    document.querySelectorAll('[data-palette-swatch]').forEach(el => {
        el.classList.toggle('active', el.dataset.paletteSwatch === palette);
    });
}

export function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
    updateIcons(theme);
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

export function toggleTheme() {
    const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    applyTheme(current === 'light' ? 'dark' : 'light');
}

export function setPalette(palette) {
    if (!VALID_PALETTES.includes(palette)) palette = 'original';
    document.documentElement.dataset.palette = palette;
    try { localStorage.setItem(PALETTE_KEY, palette); } catch (e) { /* ignore */ }
    updatePaletteUI(palette);
    window.dispatchEvent(new CustomEvent('themechange', { detail: { palette } }));
}

export function initTheme() {
    const theme = document.documentElement.dataset.theme
        || (() => { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } })()
        || 'dark';
    document.documentElement.dataset.theme = theme;
    updateIcons(theme);

    const palette = document.documentElement.dataset.palette
        || (() => { try { return localStorage.getItem(PALETTE_KEY); } catch (e) { return null; } })()
        || 'original';
    document.documentElement.dataset.palette = palette;
    updatePaletteUI(palette);
}
