// Entry point. Wires DOM events through a delegated `data-action` registry
// so no module needs to expose globals on `window`.
import './modules/api.js'; // installs the configurable API base; must load first
import { state } from './modules/state.js';
import { initNative } from './modules/native.js';
import {
    initAuth, switchAuthTab, handleAuth, loginAsDemo, logout, loginWithPasskey,
    openForgotPassword, closeForgotPassword, submitForgotPassword, submitResetPassword,
} from './modules/auth.js';
import {
    toggleSidebar, collapseSidebar,
} from './modules/sidebar.js';
import { renameLog, closeRenameModal, submitRename, closeDeleteModal } from './modules/modals.js';
import { switchView, toggleMetrics, filterToggles, toggleFocusMode, toggleChannelRail } from './modules/view.js';
import { toggleAllParams } from './modules/chart.js';
import {
    openMetricsEditor, closeMetricsEditor, addMetricRow,
    resetMetricsEditor, saveMetricsEditor, renderMetricTiles,
} from './modules/metrics.js';
import {
    openUploadModal, closeUploadModal,
    submitUrlImportModal, handleUrlImport, wireDropZones,
    downloadLog,
} from './modules/upload.js';
import { toggleAiDrawer, triggerAnalysis, submitChat } from './modules/analysis.js';
import {
    renderLibraryLogs, bulkMovePrompt, clearBulkSelection,
    closeMoveLogsModal, submitMoveLogs, compareSelectedLogs,
} from './modules/library.js';
import {
    newBuildPrompt, closeNewBuildModal, submitNewBuild,
    openBuildDetails, closeBuildDetails, saveBuildDetails,
    renderBuildsView, viewBuildLogs, editBuildFromView, deleteBuildFromView,
} from './modules/builds.js';
import {
    saveUserSettings, updateUsername, registerPasskey,
    renamePasskey, deletePasskey, openUpgradeModal, closeUpgradeModal, submitUpgrade, downgradeToFree,
    deletePaymentMethod, setDefaultPaymentMethod, openAddCardModal, closeAddCardModal, submitAddCard,
    toggleNewCardForm, reactivateSubscription,
    openEmailRequiredModal, closeEmailRequiredModal, submitAccountEmail,
} from './modules/settings.js';
import { initTheme, toggleTheme, setPalette } from './modules/theme.js';
import { generateTuningModule, swapTuningLogs } from './modules/tuning.js';
import {
    linkBootmod3, unlinkBootmod3, importSelectedBootmod3,
    refreshBootmod3Logs, toggleAllBootmod3,
} from './modules/bootmod3.js';

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
    toggleTheme,
    setPalette: (el) => setPalette(el.dataset.paletteSwatch),
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
    toggleChannelRail,
    toggleAllParams: (el) => toggleAllParams(el.dataset.checked === 'true'),
    openMetricsEditor,
    closeMetricsEditor,
    addMetricRow,
    resetMetricsEditor,
    saveMetricsEditor,

    // AI drawer
    toggleAiDrawer,
    triggerAnalysis,

    // AI Tuning Module
    generateTuningModule,
    swapTuningLogs,

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
    compareSelectedLogs,
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

    // Subscription
    openUpgradeModal,
    closeUpgradeModal,
    submitUpgrade,
    downgradeToFree,
    reactivateSubscription,
    toggleNewCardForm,

    // Payment methods
    deletePaymentMethod: (el) => deletePaymentMethod(parseInt(el.dataset.id, 10), el.dataset.lastFour),
    setDefaultPaymentMethod: (el) => setDefaultPaymentMethod(parseInt(el.dataset.id, 10), el),
    openAddCardModal,
    closeAddCardModal,
    submitAddCard,
    openEmailRequiredModal,
    closeEmailRequiredModal,
    submitAccountEmail,

    // bootmod3 linked account
    linkBootmod3,
    unlinkBootmod3,
    importSelectedBootmod3,
    refreshBootmod3Logs,
    toggleAllBootmod3,
    goToBootmod3Settings: () => switchView('settings'),
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
    renderMetricTiles(); // show the (empty) metric tiles before a log is loaded

    const params = new URLSearchParams(window.location.search);
    if (params.has('token')) {
        document.getElementById('resetPasswordModal').style.display = 'flex';
    }

    // Surface a failed SSO round-trip (redirected here by the auth callback).
    if (params.has('auth_error')) {
        const el = document.getElementById('authError');
        if (el) el.textContent = params.get('auth_error') || 'Sign-in failed. Please try again.';
        const url = new URL(window.location);
        url.searchParams.delete('auth_error');
        window.history.replaceState({}, '', url);
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

initTheme();
initAuth();
initNative();

// Optional motion / WebGL layers — progressive enhancement only, never fatal.
import('./modules/motion.js?v=7.1').then(m => m.initMotion()).catch(() => { });
// Animated WebGL backdrop runs on the login screen only. It used to also run
// app-wide on #appScene, where it showed through behind the dyno/graph and was
// distracting (and cost an extra GPU context).
import('/static/landing/modules/background.js?v=1.3').then(m => {
    m.initBackground(document.getElementById('authScene'));
}).catch(console.error);

import('/static/landing/modules/scramble.js?v=1.0').then(m => m.initScramble()).catch(console.error);

import('./modules/playback.js?v=1.0').then(m => m.initPlayback()).catch(console.error);
