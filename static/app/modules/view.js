import { state } from './state.js';
import { renderLibrary } from './library.js';
import { renderProjectsView } from './projects.js';
import { loadUserSettings } from './settings.js';

export function switchView(view) {
    state.currentView = view;
    document.body.classList.toggle('view-library', view === 'library');
    document.body.classList.toggle('view-settings', view === 'settings');

    document.querySelectorAll('[data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });

    if (view === 'dashboard') {
        document.querySelector('.dashboard-grid').style.display = 'grid';
        document.getElementById('libraryView').style.display = 'none';
        document.getElementById('projectsView').style.display = 'none';
        document.getElementById('settingsView').style.display = 'none';
        setTimeout(() => { if (state.currentChart) state.currentChart.resize(); }, 50);
    } else if (view === 'library') {
        document.querySelector('.dashboard-grid').style.display = 'none';
        document.getElementById('libraryView').style.display = 'block';
        document.getElementById('projectsView').style.display = 'none';
        document.getElementById('settingsView').style.display = 'none';
        renderLibrary();
    } else if (view === 'projects') {
        document.querySelector('.dashboard-grid').style.display = 'none';
        document.getElementById('libraryView').style.display = 'none';
        document.getElementById('projectsView').style.display = 'block';
        document.getElementById('settingsView').style.display = 'none';
        renderProjectsView();
    } else if (view === 'settings') {
        document.querySelector('.dashboard-grid').style.display = 'none';
        document.getElementById('libraryView').style.display = 'none';
        document.getElementById('projectsView').style.display = 'none';
        document.getElementById('settingsView').style.display = 'block';
        loadUserSettings();
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
