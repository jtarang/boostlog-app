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

            const btnRerun = document.getElementById('btnRerunAnalyze');

            if (analyses.length === 0) {
                historySection.style.display = 'none';
                chatBox.innerHTML = '<div class="msg system">Ready for AI Analysis. Click the turbo button to begin.</div>';
                if (btnAnalyze) { btnAnalyze.disabled = state.analysisRunning; btnAnalyze.style.display = 'block'; }
                if (btnRerun) { btnRerun.style.display = 'none'; }
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
            if (btnAnalyze) { btnAnalyze.style.display = 'none'; }
            if (btnRerun) { btnRerun.disabled = state.analysisRunning; btnRerun.style.display = 'inline-block'; }
            const chatForm = document.getElementById('chatForm');
            if (chatForm) chatForm.style.display = 'flex';
            if (fabAi) fabAi.disabled = false;
        })
        .catch(() => {
            historySection.style.display = 'none';
            chatBox.innerHTML = '<div class="msg system">Ready for AI Analysis. Click the turbo button to begin.</div>';
            if (btnAnalyze) { btnAnalyze.disabled = state.analysisRunning; btnAnalyze.style.display = 'block'; }
            const btnRerun = document.getElementById('btnRerunAnalyze');
            if (btnRerun) { btnRerun.style.display = 'none'; }
            const chatForm = document.getElementById('chatForm');
            if (chatForm) chatForm.style.display = 'none';
            if (fabAi) fabAi.disabled = false;
        });
}

let currentChatHistory = [];

function renderAnalysisContent(analysis) {
    const chatBox = document.getElementById('chatBox');
    const when = new Date(analysis.created_at).toLocaleString();
    currentChatHistory = [];
    chatBox.innerHTML = `
        <div class="msg system" style="margin-bottom: 8px; font-size: 11px;">📋 Analysis from ${when} &nbsp;·&nbsp; <span style="opacity:0.6;">${analysis.model_used}</span></div>
        <div class="markdown-body msg-ai">${marked.parse(analysis.result_markdown)}</div>
    `;

    // Fetch and render chat history
    fetch(`/api/analyze/${state.currentServerFile}/chat`, { headers: getAuthHeaders() })
        .then(res => res.json())
        .then(data => {
            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(msg => {
                    currentChatHistory.push({ role: msg.role, content: msg.content });
                    
                    const div = document.createElement('div');
                    div.className = msg.role === 'user' ? 'msg-user' : 'msg-ai markdown-body';
                    
                    if (msg.role === 'user') {
                        div.textContent = msg.content;
                    } else {
                        div.innerHTML = marked.parse(msg.content);
                    }
                    chatBox.appendChild(div);
                });
                chatBox.scrollTop = chatBox.scrollHeight;
            }
        })
        .catch(err => console.error("Failed to load chat history:", err));
}

export async function submitChat() {
    const input = document.getElementById('chatInput');
    const chatBox = document.getElementById('chatBox');
    const msg = input.value.trim();
    if (!msg || !state.currentServerFile) return;

    input.value = '';
    const btnSend = document.getElementById('btnSendChat');
    btnSend.disabled = true;

    // Append user message
    const userDiv = document.createElement('div');
    userDiv.className = 'msg-user';
    userDiv.textContent = msg;
    chatBox.appendChild(userDiv);
    chatBox.scrollTop = chatBox.scrollHeight;

    currentChatHistory.push({ role: 'user', content: msg });

    // Append loading indicator
    const aiDiv = document.createElement('div');
    aiDiv.className = 'msg-ai markdown-body';
    aiDiv.innerHTML = '<span style="opacity: 0.6;">Thinking...</span>';
    chatBox.appendChild(aiDiv);
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
        const res = await fetch(`/api/analyze/${state.currentServerFile}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({ messages: currentChatHistory })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to send message');

        const aiResponse = data.response;
        aiDiv.innerHTML = marked.parse(aiResponse);
        currentChatHistory.push({ role: 'assistant', content: aiResponse });
    } catch (err) {
        aiDiv.innerHTML = `<span style="color: var(--danger);">${err.message}</span>`;
        currentChatHistory.pop(); // Remove the user message from history so they can retry
    } finally {
        btnSend.disabled = false;
        chatBox.scrollTop = chatBox.scrollHeight;
        input.focus();
    }
}

export async function triggerAnalysis() {
    if (!state.currentServerFile || state.analysisRunning) return;

    state.analysisRunning = true;
    const analysisFile = state.currentServerFile;
    state.analysisRunningFile = analysisFile;
    state.analysisRunningName = document.getElementById('pageTitle')?.textContent || analysisFile;
    document.querySelector('#logItems li.active-log')?.classList.add('analyzing-log');
    const btn = document.getElementById('btnAnalyze');
    const btnRerun = document.getElementById('btnRerunAnalyze');
    const chatBox = document.getElementById('chatBox');
    const fabAi = document.getElementById('fabAi');

    if (btn) { btn.disabled = true; btn.innerHTML = 'Analyzing...'; }
    if (btnRerun) { btnRerun.disabled = true; btnRerun.innerHTML = '...'; }
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
        if (btn) { btn.disabled = false; btn.innerHTML = 'Retry Analysis'; }
        if (btnRerun) { btnRerun.disabled = false; btnRerun.innerHTML = 'Re-run'; }
    }
}
