/* The instrument: a synthetic but believable WOT pull rendered on canvas.
   Draw-in starts when scrolled into view; hover scrubs a crosshair HUD. */

export function initTelemetry() {
    const canvas = document.getElementById('telemetry');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const hud = document.getElementById('chartHud');
    const hudRpm = document.getElementById('hudRpm');
    const hudRows = document.getElementById('hudRows');
    const redline = document.getElementById('chartRedline');

    const elBoost = document.getElementById('tickBoost');
    const elAfr = document.getElementById('tickAfr');
    const elRpm = document.getElementById('tickRpm');
    const elIat = document.getElementById('tickIat');

    const css = getComputedStyle(document.documentElement);
    const COL = {
        boost: (css.getPropertyValue('--accent') || '#8338ec').trim(),
        target: 'rgba(237, 238, 244, 0.6)',
        afr: (css.getPropertyValue('--amber') || '#ffb454').trim(),
        torque: (css.getPropertyValue('--cyan') || '#54e2ff').trim(),
    };

    const N = 200;
    let H = canvas.offsetHeight || 300;

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

    const rpmAt = (i) => Math.round(2500 + (i / (N - 1)) * 4500);
    const boostPsi = (i) => (boostData[i] / maxBoost) * 18.4;
    const targetPsi = (i) => (targetData[i] / maxBoost) * 18.4;
    const torqueNm = (i) => Math.max(0, (torqueData[i] / maxTorque) * 412);
    const afrAt = (i) => 14.2 - (Math.max(0, boostPsi(i)) / 18.4) * 2.8 + (lambdaData[i] - 0.22) * 2;

    const yOf = (v) => H * 0.88 - v * (H / 1.1);

    const fmtRpm = (v) => Math.round(v).toLocaleString('en-US').replace(/,/g, ' ');

    function updateStripValues(i) {
        if (elBoost) elBoost.textContent = boostPsi(i).toFixed(1);
        if (elAfr) elAfr.textContent = afrAt(i).toFixed(1);
        if (elRpm) elRpm.textContent = fmtRpm(rpmAt(i));
        if (elIat) {
            const iat = 31.5 + (i / (N - 1)) * 3.5 + Math.sin(i * 0.15) * 0.2;
            elIat.textContent = iat.toFixed(1);
        }
    }

    let currentProgress = 0;
    let hoverIndex = null;
    let redlineShown = false;
    let loopIndex = 0;
    let scanAnimFrame = null;

    function draw(progress = 1, hoverIdx = null) {
        const W = canvas.offsetWidth;
        const clipN = Math.max(2, Math.floor(N * Math.min(progress, 1)));

        ctx.clearRect(0, 0, W, H);

        // Graph-paper grid
        ctx.strokeStyle = 'rgba(235,238,248,0.045)';
        ctx.fillStyle = 'rgba(235,238,248,0.26)';
        ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
        ctx.lineWidth = 1;

        const gridH = 44;
        const yLabels = ['30 PSI', '24 PSI', '18 PSI', '12 PSI', '6 PSI', '0 PSI', '-6 INHG'];
        for (let i = 0; i <= Math.floor(H / gridH); i++) {
            const y = i * gridH;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
            if (i < yLabels.length) ctx.fillText(yLabels[i], 8, y + 13);
        }

        const gridW = 44;
        for (let i = 0; i <= Math.floor(W / gridW); i++) {
            const x = i * gridW;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            if (i > 0 && i % 3 === 0) {
                ctx.fillText(Math.round(2500 + (x / W) * 4500) + ' RPM', x + 6, H - 8);
            }
        }

        // Zero baseline
        ctx.strokeStyle = 'rgba(235,238,248,0.1)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(0, H * 0.72); ctx.lineTo(W, H * 0.72); ctx.stroke();
        ctx.setLineDash([]);

        function drawLine(data, color, lineW, { dashed = false, fill = false } = {}) {
            if (data.length < 2) return;

            if (fill) {
                const areaGrad = ctx.createLinearGradient(0, 0, 0, H);
                areaGrad.addColorStop(0, 'rgba(131,56,236,0.14)');
                areaGrad.addColorStop(0.65, 'rgba(131,56,236,0)');
                ctx.beginPath();
                data.forEach((v, i) => {
                    const x = (i / (N - 1)) * W;
                    i === 0 ? ctx.moveTo(x, yOf(v)) : ctx.lineTo(x, yOf(v));
                });
                ctx.lineTo(((data.length - 1) / (N - 1)) * W, H * 0.72);
                ctx.lineTo(0, H * 0.72);
                ctx.closePath();
                ctx.fillStyle = areaGrad;
                ctx.fill();
            }

            ctx.beginPath();
            ctx.shadowColor = color;
            ctx.shadowBlur = 9;
            if (dashed) ctx.setLineDash([6, 5]);
            data.forEach((v, i) => {
                const x = (i / (N - 1)) * W;
                i === 0 ? ctx.moveTo(x, yOf(v)) : ctx.lineTo(x, yOf(v));
            });
            ctx.strokeStyle = color;
            ctx.lineWidth = lineW;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
        }

        drawLine(torqueData.slice(0, clipN), COL.torque, 1.4);
        drawLine(lambdaData.slice(0, clipN), COL.afr, 1.2);
        drawLine(targetData.slice(0, clipN), COL.target, 1.1, { dashed: true });
        drawLine(boostData.slice(0, clipN), COL.boost, 2.4, { fill: true });

        // Scan line at the draw frontier
        if (progress < 0.99) {
            const scanX = (clipN / N) * W;
            const scanGrad = ctx.createLinearGradient(scanX - 6, 0, scanX + 6, 0);
            scanGrad.addColorStop(0, 'transparent');
            scanGrad.addColorStop(0.5, 'rgba(131,56,236,0.55)');
            scanGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = scanGrad;
            ctx.fillRect(scanX - 6, 0, 12, H);
        }

        // Hover crosshair + series dots
        if (hoverIdx !== null && progress >= 0.99) {
            const x = (hoverIdx / (N - 1)) * W;
            ctx.strokeStyle = 'rgba(237,238,244,0.3)';
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            ctx.setLineDash([]);

            const dot = (data, color) => {
                ctx.beginPath();
                ctx.arc(x, yOf(data[hoverIdx]), 3.4, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.shadowColor = color;
                ctx.shadowBlur = 10;
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = 'rgba(7,9,10,0.9)';
                ctx.stroke();
            };
            dot(torqueData, COL.torque);
            dot(lambdaData, COL.afr);
            dot(targetData, COL.target);
            dot(boostData, COL.boost);
        }
    }

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
        if (redline) redline.classList.toggle('flash', on);
    }

    function pointerMove(e) {
        if (currentProgress < 0.99) return;
        const W = canvas.offsetWidth;
        const x = e.offsetX != null ? e.offsetX : (e.touches && e.touches[0]
            ? e.touches[0].clientX - canvas.getBoundingClientRect().left : 0);
        hoverIndex = Math.max(0, Math.min(N - 1, Math.round((x / W) * (N - 1))));
        draw(1, hoverIndex);
        updateHud(hoverIndex);
        if (hud) hud.classList.add('active');
        setRedline(Math.abs(hoverIndex - peakBoostIndex) < N * 0.05);
        updateStripValues(hoverIndex);
    }

    function pointerLeave() {
        if (hoverIndex !== null) {
            loopIndex = hoverIndex;
        }
        hoverIndex = null;
        if (hud) hud.classList.remove('active');
        setRedline(false);
    }

    canvas.addEventListener('mousemove', pointerMove);
    canvas.addEventListener('mouseleave', pointerLeave);
    canvas.addEventListener('touchstart', pointerMove, { passive: true });
    canvas.addEventListener('touchmove', pointerMove, { passive: true });
    canvas.addEventListener('touchend', pointerLeave);

    let animStart = null;
    const ANIM_DURATION = 1900;

    function runScanLoop() {
        if (hoverIndex === null) {
            loopIndex = (loopIndex + 1) % N;
            draw(1, loopIndex);
            updateStripValues(loopIndex);
            setRedline(Math.abs(loopIndex - peakBoostIndex) < N * 0.05);
        }
        scanAnimFrame = requestAnimationFrame(runScanLoop);
    }

    function startScanLoop() {
        if (scanAnimFrame) cancelAnimationFrame(scanAnimFrame);
        scanAnimFrame = requestAnimationFrame(runScanLoop);
    }

    function animate(timestamp) {
        if (!animStart) animStart = timestamp;
        const t = Math.min((timestamp - animStart) / ANIM_DURATION, 1);
        currentProgress = 1 - Math.pow(1 - t, 2.5);
        draw(currentProgress);

        const drawIdx = Math.min(N - 1, Math.floor(currentProgress * (N - 1)));
        updateStripValues(drawIdx);

        if (!redlineShown && currentProgress * N >= peakBoostIndex) {
            redlineShown = true;
            setRedline(true);
            setTimeout(() => { if (hoverIndex === null) setRedline(false); }, 1100);
        }

        if (t < 1) {
            requestAnimationFrame(animate);
        } else {
            startScanLoop();
        }
    }

    function resize() {
        H = canvas.offsetHeight || 300;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = H * dpr;
        ctx.scale(dpr, dpr);
        draw(currentProgress, hoverIndex);
    }

    window.addEventListener('resize', resize);
    resize();

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        currentProgress = 1;
        draw(1);
        updateStripValues(N - 1);
        return;
    }

    // Start the draw-in when the instrument scrolls into view.
    const io = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
            requestAnimationFrame(animate);
            io.disconnect();
        }
    }, { threshold: 0.25 });
    io.observe(canvas);
}
