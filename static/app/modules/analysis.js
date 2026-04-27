import { state } from './state.js';
import { getAuthHeaders } from './utils.js';
import { refreshLogList } from './sidebar.js';

export function toggleAiDrawer() {
    document.getElementById('aiDrawer').classList.toggle('open');
    document.getElementById('aiDrawerOverlay').classList.toggle('open');
}

export function loadAnalysisHistory(filename) {
    const btnAnalyze = document.getElementById('btnAnalyze');
    const fabAi = document.getElementById('fabAi');
    const chatBox = document.getElementById('chatBox');
    const historySection = document.getElementById('analysisHistory');
    const historyPills = document.getElementById('historyPills');
    const historyCount = document.getElementById('historyCount');

    fetch(`/api/analyses/${filename}`, { headers: getAuthHeaders() })
        .then(res => res.json())
        .then(data => {
            const analyses = data.analyses || [];

            if (analyses.length === 0) {
                historySection.style.display = 'none';
                chatBox.innerHTML = '<div class="msg system">Ready for AI Analysis. Click the turbo button to begin.</div>';
                if (btnAnalyze) { btnAnalyze.disabled = state.analysisRunning; btnAnalyze.innerHTML = 'Start Analysis'; btnAnalyze.classList.remove('btn-rerun'); }
                if (fabAi) fabAi.disabled = false;
                return;
            }

            historySection.style.display = 'block';
            historyCount.textContent = `${analyses.length} run${analyses.length > 1 ? 's' : ''}`;
            historyPills.innerHTML = '';

            analyses.forEach((a, i) => {
                const pill = document.createElement('button');
                pill.className = 'history-pill' + (i === 0 ? ' active' : '');
                const d = new Date(a.created_at);
                pill.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                pill.title = `Model: ${a.model_used}`;
                pill.addEventListener('click', () => {
                    document.querySelectorAll('.history-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                    renderAnalysisContent(a);
                });
                historyPills.appendChild(pill);
            });

            renderAnalysisContent(analyses[0]);
            if (btnAnalyze) { btnAnalyze.disabled = state.analysisRunning; btnAnalyze.innerHTML = 'Re-run Analysis'; btnAnalyze.classList.add('btn-rerun'); }
            if (fabAi) fabAi.disabled = false;
        })
        .catch(() => {
            historySection.style.display = 'none';
            chatBox.innerHTML = '<div class="msg system">Ready for AI Analysis. Click the turbo button to begin.</div>';
            if (btnAnalyze) { btnAnalyze.disabled = state.analysisRunning; btnAnalyze.innerHTML = 'Start Analysis'; btnAnalyze.classList.remove('btn-rerun'); }
            if (fabAi) fabAi.disabled = false;
        });
}

function renderAnalysisContent(analysis) {
    const chatBox = document.getElementById('chatBox');
    const when = new Date(analysis.created_at).toLocaleString();
    chatBox.innerHTML = `
        <div class="msg system" style="margin-bottom: 8px; font-size: 11px;">📋 Analysis from ${when} &nbsp;·&nbsp; <span style="opacity:0.6;">${analysis.model_used}</span></div>
        <div class="markdown-body" style="padding: 10px; font-size: 14px; text-align: left; color: var(--text-primary);">${marked.parse(analysis.result_markdown)}</div>
    `;
}

export async function triggerAnalysis() {
    if (!state.currentServerFile || state.analysisRunning) return;

    state.analysisRunning = true;
    const analysisFile = state.currentServerFile;
    state.analysisRunningFile = analysisFile;
    state.analysisRunningName = document.getElementById('pageTitle')?.textContent || analysisFile;
    document.querySelector('#logItems li.active-log')?.classList.add('analyzing-log');
    const btn = document.getElementById('btnAnalyze');
    const chatBox = document.getElementById('chatBox');
    const fabAi = document.getElementById('fabAi');

    btn.disabled = true;
    btn.innerHTML = 'Analyzing...';
    fabAi?.classList.add('analyzing');
    chatBox.innerHTML = `
        <div class="ai-thinking">
            <div class="ai-thinking-header">
                <span class="ai-thinking-label">Agent is analysing telemetry</span>
            </div>
            <div class="ai-thinking-dots">
                <span></span><span></span><span></span>
            </div>
            <div class="ai-thinking-steps" id="thinkingSteps"></div>
        </div>
    `;

    const steps = [
        'Reading datalog headers...',
        'Scanning boost trace...',
        'Checking ignition timing...',
        'Evaluating fueling data...',
        'Cross-referencing ECU parameters...',
        'Building tuning report...',
    ];
    const stepsEl = document.getElementById('thinkingSteps');
    let stepIndex = 0;
    const stepInterval = setInterval(() => {
        if (!stepsEl) return clearInterval(stepInterval);
        if (stepIndex < steps.length) {
            const line = document.createElement('div');
            line.className = 'thinking-step';
            line.textContent = steps[stepIndex++];
            stepsEl.appendChild(line);
            stepsEl.scrollTop = stepsEl.scrollHeight;
        }
    }, 1800);

    try {
        const res = await fetch(`/api/analyze/${analysisFile}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await res.json();

        if (res.status === 429) throw new Error('Analysis already in progress — please wait for it to finish.');
        if (!res.ok) throw new Error(data.detail || 'Analysis failed');

        clearInterval(stepInterval);
        state.analysisRunning = false;
        state.analysisRunningFile = null;
        state.analysisRunningName = null;
        document.querySelector('#logItems li.analyzing-log')?.classList.remove('analyzing-log');
        fabAi?.classList.remove('analyzing');
        if (analysisFile === state.currentServerFile) loadAnalysisHistory(state.currentServerFile);
        refreshLogList();
        if (!document.getElementById('aiDrawer').classList.contains('open')) {
            toggleAiDrawer();
        }
    } catch (err) {
        clearInterval(stepInterval);
        state.analysisRunning = false;
        state.analysisRunningFile = null;
        state.analysisRunningName = null;
        document.querySelector('#logItems li.analyzing-log')?.classList.remove('analyzing-log');
        fabAi?.classList.remove('analyzing');
        chatBox.innerHTML = `<div class="msg" style="color: var(--danger);">Error: ${err.message}</div>`;
        btn.disabled = false;
        btn.innerHTML = 'Retry Analysis';
    }
}
