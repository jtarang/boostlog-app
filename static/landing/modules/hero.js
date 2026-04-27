export function initHeroChart() {
    const canvas = document.getElementById('heroChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Seeded noise for natural tiny variance without waves
    function noise(seed) {
        let s = seed;
        return () => { s = (s * 16807 + 0) % 2147483647; return (s / 2147483647) - 0.5; };
    }

    function genBoost(n) {
        const rng = noise(42);
        return Array.from({ length: n }, (_, i) => {
            const t = i / n;
            // Aggressive dyno curve: lag then violent spool
            const spool = 1 / (1 + Math.exp(-35 * (t - 0.35)));
            const hold = 0.48 - 0.02 * Math.max(0, t - 0.6);
            return spool * hold - 0.04 + rng() * 0.008;
        });
    }

    function genTarget(n) {
        return Array.from({ length: n }, (_, i) => {
            const t = i / n;
            // Target steps up aggressively right before boost hits
            const ramp = 1 / (1 + Math.exp(-50 * (t - 0.30)));
            const hold = 0.50 - 0.01 * Math.max(0, t - 0.6);
            return ramp * hold;
        });
    }

    function genTorque(n) {
        const rng = noise(13);
        return Array.from({ length: n }, (_, i) => {
            const t = i / n;
            // Huge torque spike with the boost hit, then tapers off hard (classic dyno)
            const rise = 1 / (1 + Math.exp(-35 * (t - 0.35)));
            const peak = 1 - 0.65 * Math.max(0, t - 0.45);
            return rise * peak * 0.55 - 0.02 + rng() * 0.006;
        });
    }

    function draw() {
        const W = canvas.offsetWidth;
        const H = 240;
        ctx.clearRect(0, 0, W, H);
        const n = 200;

        // Grid & Realistic Axis Labels
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '10px "Inter", sans-serif';
        ctx.lineWidth = 1;

        const gridSize = 40;
        const numRows = Math.floor(H / gridSize);
        const yLabels = ["30 psi", "24 psi", "18 psi", "12 psi", "6 psi", "0 psi", "-6 inHg"];

        for (let i = 0; i <= numRows; i++) {
            const y = i * gridSize;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
            if (i < 6) ctx.fillText(yLabels[i], 8, y + 14);
        }

        const numCols = Math.floor(W / gridSize);
        for (let i = 0; i <= numCols; i++) {
            const x = i * gridSize;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();

            // Label every 3rd vertical line to prevent crowding
            if (i > 0 && i % 3 === 0) {
                const rpm = Math.round(2500 + (x / W) * 4500);
                ctx.fillText(rpm + " rpm", x + 6, H - 8);
            }
        }

        // Zero line
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(0, H * 0.72); ctx.lineTo(W, H * 0.72); ctx.stroke();
        ctx.setLineDash([]);

        // Draw line
        function drawLine(data, color, glowColor, lineW = 1.5) {
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, glowColor.replace(/[\d.]+\)$/, '0.15)'));
            grad.addColorStop(0.5, 'transparent');

            // Fill area
            ctx.beginPath();
            data.forEach((v, i) => {
                const x = (i / (n - 1)) * W;
                const y = H * 0.88 - v * (H / 1.1);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            ctx.lineTo(W, H * 0.72); ctx.lineTo(0, H * 0.72); ctx.closePath();
            ctx.fillStyle = grad; ctx.fill();

            // Line
            ctx.beginPath();
            ctx.shadowColor = glowColor; ctx.shadowBlur = 8;
            data.forEach((v, i) => {
                const x = (i / (n - 1)) * W;
                const y = H * 0.88 - v * (H / 1.1);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            ctx.strokeStyle = color; ctx.lineWidth = lineW; ctx.stroke();
            ctx.shadowBlur = 0;
        }

        const boost = genBoost(n);
        const target = genTarget(n);
        const torque = genTorque(n);

        drawLine(torque, 'rgba(131,56,236,0.8)', 'rgba(131,56,236,1)', 1.5);
        drawLine(target, 'rgba(232,49,122,0.5)', 'rgba(232,49,122,1)', 1.2);
        drawLine(boost, '#3A86FF', 'rgba(58,134,255,1)', 2.5);
    }

    function resize() {
        canvas.width = canvas.offsetWidth * window.devicePixelRatio;
        canvas.height = 240 * window.devicePixelRatio;
        canvas.style.height = '240px';
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        draw();
    }

    resize();
    window.addEventListener('resize', resize);
}
