import { state } from './state.js';
import { updateLiveMetrics, calculateMetrics } from './metrics.js';

let playbackRafId = null;
let isPlaying = false;

export function initPlayback() {
    const btnPlayLog = document.getElementById('btnPlayLog');
    if (!btnPlayLog) return;
    
    btnPlayLog.addEventListener('click', () => {
        if (!state.currentChart || !state.currentData || state.currentData.length === 0) return;
        
        if (isPlaying) {
            stopPlayback();
            btnPlayLog.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg><span>Play</span>`;
        } else {
            startPlayback();
            btnPlayLog.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg><span>Stop</span>`;
        }
    });
}

export function startPlayback() {
    if (isPlaying || !state.currentChart) return;
    isPlaying = true;

    const chart = state.currentChart;
    const dataset = chart.data.datasets[0].data;
    if (dataset.length < 2) return;

    const minX = dataset[0].x;
    const maxX = dataset[dataset.length - 1].x;
    
    // Disable interaction during playback
    chart.options.interaction.mode = null;

    const duration = 5000; // 5 seconds
    let startTime = null;

    function animate(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        let progress = elapsed / duration;

        if (progress >= 1) progress = 1;

        // Current max X to display
        const currentMaxX = minX + (maxX - minX) * progress;

        // Update chart
        chart.options.scales.x.max = currentMaxX;
        chart.update('none');

        // Find current row index based on progress to update HUD
        const targetIndex = Math.floor(progress * (dataset.length - 1));
        const row = state.currentData[targetIndex];
        if (row) {
            updateLiveMetrics(row, false);
        }

        if (progress < 1 && isPlaying) {
            playbackRafId = requestAnimationFrame(animate);
        } else {
            stopPlayback(true);
        }
    }

    playbackRafId = requestAnimationFrame(animate);
}

export function stopPlayback(finished = false) {
    if (!isPlaying) return;
    isPlaying = false;
    
    if (playbackRafId) {
        cancelAnimationFrame(playbackRafId);
        playbackRafId = null;
    }

    if (state.currentChart) {
        // Restore full scale
        delete state.currentChart.options.scales.x.max;
        // Restore interaction
        state.currentChart.options.interaction.mode = 'index';
        state.currentChart.update('none');
    }

    // Restore max metrics
    calculateMetrics();

    const btnPlayLog = document.getElementById('btnPlayLog');
    if (btnPlayLog) {
        btnPlayLog.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg><span>Play</span>`;
    }
}
