// Shared mutable state. Single source of truth across modules.
export const state = {
    authToken: localStorage.getItem('boostlog_token') || null,
    authMode: 'login',
    currentServerFile: null,
    currentLogId: null,
    currentBuilds: [],
    currentLogs: [],
    hasAnalysisById: new Map(),
    currentView: 'dashboard',
    libraryFilter: 'all',
    bulkSelection: new Set(),
    currentChart: null,
    analysisRunning: false,
    analysisRunningFile: null,
    analysisRunningName: null,
    currentData: null,
    currentHeaders: [],
    pendingBuildCallback: null,
    renameOnSave: null,
    autofillStarted: false,
};

export const SIDEBAR_LOG_LIMIT = 5;

export const lineColors = [
    '#3A86FF', '#FF006E', '#8338EC', '#FFBE0B', '#FB5607',
    '#38B000', '#00F5D4', '#F15BB5', '#9B5DE5', '#00BBF9'
];
