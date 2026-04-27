import { state } from './state.js';
import { getAuthHeaders } from './utils.js';
import { showToast } from './toast.js';
import { setActiveLog, refreshLogList } from './sidebar.js';
import { processDataForGraph } from './chart.js';
import { loadAnalysisHistory } from './analysis.js';

export function handleFile(file) {
    if (!file.name.endsWith('.csv')) {
        alert('Please upload a CSV file.');
        return;
    }

    setActiveLog(null, file.name);
    uploadToBackend(file);

    Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function (results) {
            console.log("Parsed CSV:", results.data.length, "rows");
            state.currentData = results.data;
            state.currentHeaders = results.meta.fields;
            processDataForGraph();
        },
        error: function (err) {
            console.error("Parse Error:", err);
            alert("Failed to parse CSV locally.");
        }
    });
}

export function uploadToBackend(file) {
    const formData = new FormData();
    formData.append('file', file);

    fetch('/api/upload', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
    })
        .then(r => r.json())
        .then(data => {
            setDownloadLink(data.url, data.filename);
            refreshLogList(data.id);
            if (data.duplicate) {
                setTimeout(() => showToast('Log already exists — loaded from your library.', 'info'), 300);
            }
        })
        .catch(err => console.error('Upload to backend failed:', err));
}

export function setDownloadLink(url, filename) {
    if (url) state.currentServerFile = url.split('/').pop();
    const btnDownload = document.getElementById('btnDownload');
    if (btnDownload && url) {
        btnDownload.href = url;
        btnDownload.download = filename || 'log.csv';
        btnDownload.style.display = 'flex';
    }

    const btnAnalyze = document.getElementById('btnAnalyze');
    const fabAi = document.getElementById('fabAi');
    const chatBox = document.getElementById('chatBox');

    if (btnAnalyze) { btnAnalyze.disabled = true; btnAnalyze.innerHTML = 'Loading...'; }
    if (fabAi) fabAi.disabled = true;
    if (chatBox) chatBox.innerHTML = '<div class="msg system">Checking for prior analysis...</div>';

    if (state.currentServerFile) {
        loadAnalysisHistory(state.currentServerFile);
    }
}

export function openUploadModal() {
    document.getElementById('uploadModal').style.display = 'flex';
    const hint = document.getElementById('urlImportModalHint');
    hint.textContent = '';
    hint.style.color = '';
}

export function closeUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
    document.getElementById('urlImportModalInput').value = '';
    document.getElementById('urlImportModalHint').textContent = '';
}

export async function submitUrlImportModal() {
    const input = document.getElementById('urlImportModalInput');
    const hint = document.getElementById('urlImportModalHint');
    await importFromUrl(input.value.trim(), hint, () => closeUploadModal());
}

export async function importFromUrl(url, hint, onSuccess) {
    if (!url) return;

    let fetchUrl = url;
    if (url.includes('bootmod3.net/log')) {
        fetchUrl = url.replace('bootmod3.net/log', 'bootmod3.net/dlog');
    }

    hint.style.color = 'var(--text-secondary)';
    hint.textContent = fetchUrl !== url ? 'Detected bootmod3 link, fetching CSV…' : 'Fetching…';

    try {
        const isBootmod3 = fetchUrl.includes('bootmod3.net');
        const proxyFetchUrl = isBootmod3
            ? `/api/proxy-csv?url=${encodeURIComponent(fetchUrl)}`
            : fetchUrl;

        const res = await fetch(proxyFetchUrl, { headers: isBootmod3 ? getAuthHeaders() : {} });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `Server returned ${res.status}`);
        }
        const text = await res.text();

        if (!text.includes(',') || !text.includes('\n')) {
            throw new Error('URL does not appear to be a CSV file.');
        }

        const idMatch = fetchUrl.match(/[?&]id=([^&]+)/);
        const filename = idMatch ? `dlog_${idMatch[1]}.csv` : (fetchUrl.split('/').pop().split('?')[0] || 'imported.csv');
        const file = new File([text], filename.endsWith('.csv') ? filename : filename + '.csv', { type: 'text/csv' });
        hint.textContent = '';
        onSuccess?.();
        handleFile(file);
    } catch (err) {
        hint.style.color = 'var(--danger)';
        hint.textContent = `Failed: ${err.message}`;
    }
}

export async function handleUrlImport() {
    const input = document.getElementById('urlImportInput');
    const hint = document.getElementById('urlImportHint');
    await importFromUrl(input.value.trim(), hint, () => { input.value = ''; });
}

// Drop-zone wiring; called once from main.js after DOM ready.
export function wireDropZones() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const dropZoneOverlay = document.getElementById('dropZoneOverlay');
    const fileInputOverlay = document.getElementById('fileInputOverlay');
    const fileInputModal = document.getElementById('fileInputModal');

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) { closeUploadModal(); handleFile(e.dataTransfer.files[0]); }
        });
    }
    if (fileInputModal) {
        fileInputModal.addEventListener('change', (e) => {
            if (e.target.files.length) { closeUploadModal(); handleFile(e.target.files[0]); }
        });
    }
    if (dropZoneOverlay) {
        dropZoneOverlay.addEventListener('dragover', (e) => { e.preventDefault(); dropZoneOverlay.classList.add('dragover'); });
        dropZoneOverlay.addEventListener('dragleave', () => dropZoneOverlay.classList.remove('dragover'));
        dropZoneOverlay.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZoneOverlay.classList.remove('dragover');
            if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
        });
    }
    if (fileInputOverlay) {
        fileInputOverlay.addEventListener('change', (e) => {
            if (e.target.files.length) handleFile(e.target.files[0]);
        });
    }
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) handleFile(e.target.files[0]);
        });
    }
}
