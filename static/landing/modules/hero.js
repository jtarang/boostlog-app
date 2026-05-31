export function initHeroChart() {
    const canvas = document.getElementById('heroChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const hud = document.getElementById('chartHud');
    const hudRpm = document.getElementById('hudRpm');
    const hudRows = document.getElementById('hudRows');
    const redline = document.getElementById('chartRedline');

    const H = 240;
    const N = 200;

    // Series colors (match the legend)
    const COL = {
        boost: '#3A86FF',
        target: '#e8317a',
        torque: '#8338EC',
        afr: '#f97316',
    };

    function seededRng(seed) {
        let s = seed;
        return () => { s = (s * 16807) % 2147483647; return (s / 2147483647) - 0.5; };
    }

    function genBoost() {
        const rng = seededRng(42);
        return Array.from({ length: N }, (_, i) => {
            const t = i / N;
            const spool = 1 / (1 + Math.exp(-35 * (t - 0.35)));
            const hold = 0.48 - 0.02 * Math.max(0, t - 0.6);
            return spool * hold - 0.04 + rng() * 0.008;
        });
    }

    function genTarget() {
        return Array.from({ length: N }, (_, i) => {
            const t = i / N;
            const ramp = 1 / (1 + Math.exp(-50 * (t - 0.30)));
            const hold = 0.50 - 0.01 * Math.max(0, t - 0.6);
            return ramp * hold;
        });
    }

    function genTorque() {
        const rng = seededRng(13);
        return Array.from({ length: N }, (_, i) => {
            const t = i / N;
            const rise = 1 / (1 + Math.exp(-35 * (t - 0.35)));
            const peak = 1 - 0.65 * Math.max(0, t - 0.45);
            return rise * peak * 0.55 - 0.02 + rng() * 0.006;
        });
    }

    function genLambda() {
        const rng = seededRng(77);
        return Array.from({ length: N }, (_, i) => {
            const t = i / N;
            const base = 0.22 + 0.04 * Math.sin(t * Math.PI * 2.5);
            return base + rng() * 0.012;
        });
    }

    const boostData = genBoost();
    const targetData = genTarget();
    const torqueData = genTorque();
    const lambdaData = genLambda();

    const maxBoost = Math.max(...boostData);
    const maxTorque = Math.max(...torqueData);
    const peakBoostIndex = boostData.indexOf(maxBoost);

    // ── unit conversions (believable telemetry numbers) ──────────
    const rpmAt = (i) => Math.round(2500 + (i / (N - 1)) * 4500);
    const boostPsi = (i) => (boostData[i] / maxBoost) * 18.4;
    const targetPsi = (i) => (targetData[i] / maxBoost) * 18.4;
    const torqueNm = (i) => Math.max(0, (torqueData[i] / maxTorque) * 412);
    const afrAt = (i) => {
        const psi = boostPsi(i);
        const af = 14.2 - (Math.max(0, psi) / 18.4) * 2.8 + (lambdaData[i] - 0.22) * 2;
        return af;
    };

    const yOf = (v) => H * 0.88 - v * (H / 1.1);

    let currentProgress = 0;
    let hoverIndex = null;
    let redlineShown = false;

    function draw(progress = 1, hoverIdx = null) {
        const W = canvas.offsetWidth;
        const clipN = Math.max(2, Math.floor(N * Math.min(progress, 1)));

        const light = document.documentElement.dataset.theme === 'light';
        const gridColor = light ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.04)';
        const labelColor = light ? 'rgba(15,23,42,0.5)' : 'rgba(255,255,255,0.28)';
        const baselineColor = light ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.07)';
        const dotStroke = light ? 'rgba(255,255,255,0.95)' : 'rgba(11,13,17,0.9)';

        ctx.clearRect(0, 0, W, H);

        // Grid
        ctx.strokeStyle = gridColor;
        ctx.fillStyle = labelColor;
        ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
        ctx.lineWidth = 1;

        const gridH = 40;
        const numRows = Math.floor(H / gridH);
        const yLabels = ['30 psi', '24 psi', '18 psi', '12 psi', '6 psi', '0 psi', '-6 inHg'];
        for (let i = 0; i <= numRows; i++) {
            const y = i * gridH;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
            if (i < yLabels.length) ctx.fillText(yLabels[i], 8, y + 14);
        }

        const gridW = 40;
        const numCols = Math.floor(W / gridW);
        for (let i = 0; i <= numCols; i++) {
            const x = i * gridW;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            if (i > 0 && i % 3 === 0) {
                const rpm = Math.round(2500 + (x / W) * 4500);
                ctx.fillText(rpm + ' rpm', x + 6, H - 8);
            }
        }

        // Zero baseline
        ctx.strokeStyle = baselineColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(0, H * 0.72); ctx.lineTo(W, H * 0.72); ctx.stroke();
        ctx.setLineDash([]);

        function drawLine(data, color, glowColor, lineW) {
            if (data.length < 2) return;

            const areaGrad = ctx.createLinearGradient(0, 0, 0, H);
            areaGrad.addColorStop(0, glowColor.replace(/[\d.]+\)$/, '0.12)'));
            areaGrad.addColorStop(0.6, 'transparent');

            ctx.beginPath();
            data.forEach((v, i) => {
                const x = (i / (N - 1)) * W;
                i === 0 ? ctx.moveTo(x, yOf(v)) : ctx.lineTo(x, yOf(v));
            });
            const lastX = ((data.length - 1) / (N - 1)) * W;
            ctx.lineTo(lastX, H * 0.72);
            ctx.lineTo(0, H * 0.72);
            ctx.closePath();
            ctx.fillStyle = areaGrad;
            ctx.fill();

            ctx.beginPath();
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 8;
            data.forEach((v, i) => {
                const x = (i / (N - 1)) * W;
                i === 0 ? ctx.moveTo(x, yOf(v)) : ctx.lineTo(x, yOf(v));
            });
            ctx.strokeStyle = color;
            ctx.lineWidth = lineW;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        drawLine(torqueData.slice(0, clipN), 'rgba(131,56,236,0.8)', 'rgba(131,56,236,1)', 1.5);
        drawLine(lambdaData.slice(0, clipN), COL.afr, 'rgba(249,115,22,1)', 1.2);
        drawLine(targetData.slice(0, clipN), 'rgba(232,49,122,0.6)', 'rgba(232,49,122,1)', 1.2);
        drawLine(boostData.slice(0, clipN), COL.boost, 'rgba(58,134,255,1)', 2.5);

        // Scan line at the draw frontier
        if (progress < 0.99) {
            const scanX = (clipN / N) * W;
            const scanGrad = ctx.createLinearGradient(scanX - 5, 0, scanX + 5, 0);
            scanGrad.addColorStop(0, 'transparent');
            scanGrad.addColorStop(0.5, 'rgba(131, 56, 236, 0.65)');
            scanGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = scanGrad;
            ctx.fillRect(scanX - 5, 0, 10, H);
        }

        // Hover crosshair + series dots
        if (hoverIdx !== null && progress >= 0.99) {
            const x = (hoverIdx / (N - 1)) * W;
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            ctx.setLineDash([]);

            const dot = (data, color) => {
                ctx.beginPath();
                ctx.arc(x, yOf(data[hoverIdx]), 3.5, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.shadowColor = color;
                ctx.shadowBlur = 10;
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = dotStroke;
                ctx.stroke();
            };
            dot(torqueData, COL.torque);
            dot(lambdaData, COL.afr);
            dot(targetData, COL.target);
            dot(boostData, COL.boost);
        }
    }

    // ── HUD readout ───────────────────────────────────────────────
    function updateHud(i) {
        if (!hud || !hudRpm || !hudRows) return;
        hudRpm.textContent = rpmAt(i).toLocaleString();
        const rows = [
            ['Boost', boostPsi(i).toFixed(1) + ' psi', COL.boost],
            ['Target', targetPsi(i).toFixed(1) + ' psi', COL.target],
            ['Torque', Math.round(torqueNm(i)) + ' Nm', COL.torque],
            ['AFR', afrAt(i).toFixed(1), COL.afr],
        ];
        hudRows.innerHTML = rows.map(([label, val, c]) =>
            `<div class="hud-row"><span class="hud-row-label" style="--c:${c}">${label}</span><span class="hud-row-val">${val}</span></div>`
        ).join('');
    }

    function setRedline(on) {
        if (!redline) return;
        redline.classList.toggle('flash', on);
    }

    // ── interaction ───────────────────────────────────────────────
    function pointerMove(e) {
        if (currentProgress < 0.99) return;
        const W = canvas.offsetWidth;
        const x = e.offsetX != null ? e.offsetX : (e.touches && e.touches[0]
            ? e.touches[0].clientX - canvas.getBoundingClientRect().left : 0);
        hoverIndex = Math.max(0, Math.min(N - 1, Math.round((x / W) * (N - 1))));
        draw(1, hoverIndex);
        updateHud(hoverIndex);
        if (hud) hud.classList.add('active');
        // Redline when hovering near peak boost
        setRedline(Math.abs(hoverIndex - peakBoostIndex) < N * 0.05);
    }

    function pointerLeave() {
        hoverIndex = null;
        if (hud) hud.classList.remove('active');
        setRedline(false);
        draw(1, null);
    }

    canvas.addEventListener('mousemove', pointerMove);
    canvas.addEventListener('mouseleave', pointerLeave);
    canvas.addEventListener('touchstart', pointerMove, { passive: true });
    canvas.addEventListener('touchmove', pointerMove, { passive: true });
    canvas.addEventListener('touchend', pointerLeave);

    // ── draw-in animation ─────────────────────────────────────────
    let animStart = null;
    const ANIM_DURATION = 1800;

    function animate(timestamp) {
        if (!animStart) animStart = timestamp;
        const t = Math.min((timestamp - animStart) / ANIM_DURATION, 1);
        currentProgress = 1 - Math.pow(1 - t, 2.5);
        draw(currentProgress);

        // Brief redline flash as the frontier crosses peak boost
        if (!redlineShown && currentProgress * N >= peakBoostIndex) {
            redlineShown = true;
            setRedline(true);
            setTimeout(() => { if (hoverIndex === null) setRedline(false); }, 1100);
        }

        if (t < 1) requestAnimationFrame(animate);
    }

    function resize() {
        canvas.width = canvas.offsetWidth * window.devicePixelRatio;
        canvas.height = H * window.devicePixelRatio;
        canvas.style.height = H + 'px';
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        draw(currentProgress, hoverIndex);
    }

    window.addEventListener('resize', resize);
    window.addEventListener('themechange', () => draw(currentProgress, hoverIndex));
    resize();

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        currentProgress = 1;
        draw(1);
    } else {
        requestAnimationFrame(animate);
    }
}
