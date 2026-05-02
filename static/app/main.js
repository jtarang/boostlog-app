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
    downloadLog,
} from './modules/upload.js';
import { toggleAiDrawer, triggerAnalysis, submitChat } from './modules/analysis.js';
import {
    renderLibraryLogs, bulkMovePrompt, clearBulkSelection,
    closeMoveLogsModal, submitMoveLogs,
} from './modules/library.js';
import {
    newBuildPrompt, closeNewBuildModal, submitNewBuild,
    openBuildDetails, closeBuildDetails, saveBuildDetails,
    renderBuildsView, viewBuildLogs, editBuildFromView, deleteBuildFromView,
} from './modules/builds.js';
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
    downloadLog,

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

    // Builds / Garage
    newBuildPrompt,
    closeNewBuildModal,
    submitNewBuild,
    openBuildDetails,
    closeBuildDetails,
    saveBuildDetails,
    viewBuildLogs: (el) => viewBuildLogs(parseInt(el.dataset.id, 10)),
    editBuildFromView: (el) => editBuildFromView(parseInt(el.dataset.id, 10)),
    deleteBuildFromView: (el) => deleteBuildFromView(parseInt(el.dataset.id, 10), el.dataset.name),

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
    else if (e.target.id === 'chatForm') {
        e.preventDefault();
        submitChat();
    }
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
    else if (id === 'buildsSearch') renderBuildsView();
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

    const drawer = document.getElementById('aiDrawer');
    const resizer = document.getElementById('aiDrawerResizer');
    if (drawer && resizer) {
        let isResizing = false;
        let startX, startY, startWidth, startHeight;
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = drawer.getBoundingClientRect();
            startWidth = rect.width;
            startHeight = rect.height;
            document.body.style.userSelect = 'none';
            drawer.style.transition = 'none';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const dx = startX - e.clientX;
            const dy = startY - e.clientY;
            drawer.style.width = `${startWidth + dx}px`;
            drawer.style.height = `${startHeight + dy}px`;
        });
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.userSelect = '';
                drawer.style.transition = '';
            }
        });
    }
});

initAuth();
