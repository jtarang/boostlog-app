import { state } from './state.js';
import { renderLibrary } from './library.js';
import { renderBuildsView } from './builds.js';
import { loadUserSettings } from './settings.js';
import { renderTuning } from './tuning.js';

export function switchView(view) {
    state.currentView = view;
    document.body.classList.toggle('view-library', view === 'library');
    document.body.classList.toggle('view-settings', view === 'settings');

    document.querySelectorAll('[data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Hide every view first, then reveal the requested one.
    document.querySelector('.dashboard-grid').style.display = 'none';
    document.getElementById('libraryView').style.display = 'none';
    document.getElementById('buildsView').style.display = 'none';
    document.getElementById('settingsView').style.display = 'none';
    document.getElementById('tuningView').style.display = 'none';

    // Note: library/tuning are flex-column views (CSS `display:flex`) whose
    // inner scroll containers rely on that flex chain — show them with 'flex',
    // not 'block', or their `overflow-y:auto` never gets a constrained height.
    if (view === 'dashboard') {
        document.querySelector('.dashboard-grid').style.display = 'grid';
        setTimeout(() => { if (state.currentChart) state.currentChart.resize(); }, 50);
    } else if (view === 'library') {
        document.getElementById('libraryView').style.display = 'flex';
        renderLibrary();
    } else if (view === 'builds') {
        document.getElementById('buildsView').style.display = 'block';
        renderBuildsView();
    } else if (view === 'settings') {
        document.getElementById('settingsView').style.display = 'block';
        loadUserSettings();
    } else if (view === 'tuning') {
        document.getElementById('tuningView').style.display = 'flex';
        renderTuning();
    }
}

export function toggleMetrics() {
    const body = document.getElementById('metricsBody');
    const chevron = document.getElementById('metricsChevron');
    body.classList.toggle('collapsed');
    chevron.classList.toggle('rotated');
}

export function filterToggles(query) {
    const q = query.toLowerCase().trim();
    const toggles = document.querySelectorAll('#paramToggles .toggle-label');
    toggles.forEach(lbl => {
        const text = lbl.textContent.toLowerCase();
        lbl.style.display = text.includes(q) ? '' : 'none';
    });
}

export function toggleFocusMode() {
    const isFocus = document.body.classList.toggle('focus-mode');
    const btn = document.getElementById('btnFocusMode');
    if (btn) {
        btn.querySelector('.icon-expand').style.display = isFocus ? 'none' : '';
        btn.querySelector('.icon-compress').style.display = isFocus ? '' : 'none';
        btn.querySelector('span').textContent = isFocus ? 'Exit' : 'Focus';
    }
    setTimeout(() => {
        if (state.currentChart) state.currentChart.resize();
    }, 300);
}
