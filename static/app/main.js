// Entry point. Wires DOM events through a delegated `data-action` registry
// so no module needs to expose globals on `window`.
import { state } from './modules/state.js';
import {
    initAuth, switchAuthTab, handleAuth, loginAsDemo, logout, loginWithPasskey,
    openForgotPassword, closeForgotPassword, submitForgotPassword, submitResetPassword,
} from './modules/auth.js';
import {
    toggleSidebar, collapseSidebar,
} from './modules/sidebar.js';
import { renameLog, closeRenameModal, submitRename, closeDeleteModal } from './modules/modals.js';
import { switchView, toggleMetrics, filterToggles, toggleFocusMode } from './modules/view.js';
import { toggleAllParams } from './modules/chart.js';
import {
    openUploadModal, closeUploadModal,
    submitUrlImportModal, handleUrlImport, wireDropZones,
} from './modules/upload.js';
import { toggleAiDrawer, triggerAnalysis } from './modules/analysis.js';
import {
    renderLibraryLogs, bulkMovePrompt, clearBulkSelection,
    closeMoveLogsModal, submitMoveLogs,
} from './modules/library.js';
import {
    newProjectPrompt, closeNewProjectModal, submitNewProject,
    openProjectDetails, closeProjectDetails, saveProjectDetails,
    renderProjectsView, viewProjectLogs, editProjectFromView, deleteProjectFromView,
} from './modules/projects.js';
import {
    saveUserSettings, updateUsername, registerPasskey,
    renamePasskey, deletePasskey,
} from './modules/settings.js';

// === Action registry: maps data-action="<name>" → handler(el, event) ===
const actions = {
    // Auth
    switchAuthTab: (el) => switchAuthTab(el.dataset.mode),
    loginAsDemo,
    loginWithPasskey,
    logout,
    openForgotPassword,
    closeForgotPassword,
    submitForgotPassword,
    submitResetPassword,

    // Sidebar / nav
    toggleSidebar,
    collapseSidebar,
    switchView: (el) => switchView(el.dataset.view),

    // Upload modal & URL import
    openUploadModal,
    closeUploadModal,
    submitUrlImportModal,
    handleUrlImport,

    // Chart / metrics
    toggleMetrics,
    toggleFocusMode,
    toggleAllParams: (el) => toggleAllParams(el.dataset.checked === 'true'),

    // AI drawer
    toggleAiDrawer,
    triggerAnalysis,

    // Modals (rename / delete)
    closeRenameModal,
    submitRename,
    closeDeleteModal,

    // Projects / Garage
    newProjectPrompt,
    closeNewProjectModal,
    submitNewProject,
    openProjectDetails,
    closeProjectDetails,
    saveProjectDetails,
    viewProjectLogs: (el) => viewProjectLogs(parseInt(el.dataset.id, 10)),
    editProjectFromView: (el) => editProjectFromView(parseInt(el.dataset.id, 10)),
    deleteProjectFromView: (el) => deleteProjectFromView(parseInt(el.dataset.id, 10), el.dataset.name),

    // Library
    bulkMovePrompt,
    clearBulkSelection,
    closeMoveLogsModal,
    submitMoveLogs,

    // Settings
    saveUserSettings,
    updateUsername,
    registerPasskey,
    renamePasskey: (el) => renamePasskey(parseInt(el.dataset.id, 10), el.dataset.name),
    deletePasskey: (el) => deletePasskey(parseInt(el.dataset.id, 10), el.dataset.name),
};

function dispatch(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const fn = actions[target.dataset.action];
    if (!fn) return;
    // Anchors (e.g. forgot-password link) need preventDefault
    if (target.tagName === 'A') e.preventDefault();
    fn(target, e);
}

// === Boot ===
document.addEventListener('click', dispatch);

document.addEventListener('submit', (e) => {
    if (e.target.id === 'authForm') handleAuth(e);
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const id = e.target.id;
    if (id === 'urlImportInput') handleUrlImport();
    else if (id === 'urlImportModalInput') submitUrlImportModal();
    else if (id === 'renameInput') submitRename();
});

document.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'toggleSearch') filterToggles(e.target.value);
    else if (id === 'librarySearch') renderLibraryLogs();
    else if (id === 'projectsSearch') renderProjectsView();
});

document.addEventListener('change', (e) => {
    if (e.target.id === 'librarySort') renderLibraryLogs();
});

// Page-title rename
document.addEventListener('DOMContentLoaded', () => {
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
        pageTitle.addEventListener('click', () => {
            if (state.currentLogId) renameLog(state.currentLogId, pageTitle.textContent);
        });
    }
    wireDropZones();

    const params = new URLSearchParams(window.location.search);
    if (params.has('token')) {
        document.getElementById('resetPasswordModal').style.display = 'flex';
    }
});

initAuth();
