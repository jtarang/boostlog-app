/* Background module: Fluctuating graph line and particles */

import { REDUCED, LOW_POWER, gatedLoop } from './perf.js?v=1.0';

export function initBackground(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let w, h;
    function resize() {
        w = window.innerWidth;
        h = window.innerHeight;
        // Cap DPR harder on low-power devices — this canvas is a faint backdrop,
        // so a sharper buffer isn't worth the per-pixel fill cost.
        const dpr = Math.min(window.devicePixelRatio || 1, LOW_POWER ? 1 : 2);
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();

    let time = 0;

    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8338ec';
    const cyanColor = getComputedStyle(document.documentElement).getPropertyValue('--cyan').trim() || '#54e2ff';
    const amberColor = getComputedStyle(document.documentElement).getPropertyValue('--amber').trim() || '#ffb454';

    // Sample step: wider stride on weak devices means far fewer lineTo() calls.
    const STEP = LOW_POWER ? 10 : 5;
    // Per-frame canvas shadowBlur is the single most expensive op here and tanks
    // weak GPUs. Approximate the glow with a cheap second wide, low-alpha stroke.
    const GLOW = !LOW_POWER;

    function drawLine(offsetY, ampMult, freqMult, color, alpha, glow, speedMult) {
        const t = time * speedMult;
        const path = new Path2D();
        let started = false;
        for (let x = -50; x <= w + 50; x += STEP) {
            const nx = x / w;
            // Composite wave to look like data fluctuations
            let yOff = 0;
            yOff += Math.sin(nx * 7 * freqMult + t) * 35 * ampMult;
            yOff += Math.sin(nx * 18 * freqMult + t * 2.2) * 12 * ampMult;
            yOff += Math.cos(nx * 38 * freqMult - t * 3.5) * 4 * ampMult;

            // Occasional "spikes" like engine knock or gear shifts
            const spikeP = (nx * 2.5 - t * 0.6) % 1;
            if (spikeP > 0 && spikeP < 0.08) {
                yOff += Math.sin(spikeP * Math.PI * 12.5) * 20 * ampMult;
            }

            const y = h * offsetY + yOff;
            if (!started) { path.moveTo(x, y); started = true; }
            else { path.lineTo(x, y); }
        }

        ctx.strokeStyle = color;
        if (glow && GLOW) {
            // Faux-glow: wide, faint underlay stroke instead of shadowBlur.
            ctx.globalAlpha = alpha * 0.4;
            ctx.lineWidth = 8;
            ctx.stroke(path);
        }
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2;
        ctx.stroke(path);
    }

    function render() {
        time += 0.012;
        ctx.clearRect(0, 0, w, h);

        drawLine(0.5, 1.0, 1.0, accentColor, 0.45, true, 1.0); // Main line
        drawLine(0.65, 0.7, 1.3, cyanColor, 0.25, false, 0.85); // Secondary cyan line
        drawLine(0.35, 0.5, 0.8, amberColor, 0.2, false, 1.15); // Tertiary amber line

        ctx.globalAlpha = 1.0;
    }

    if (REDUCED) {
        // Just draw one static frame.
        time = 45.0; // arbitrary time for a nice looking static wave
        render();
        return;
    }

    // Capped, tab-visibility-aware loop. The motion advances on its own `time`
    // accumulator, so a lower frame cap slows the cost, not the apparent speed.
    const loop = gatedLoop(render, { fps: 30 });

    // Pause entirely when the hero/backdrop is scrolled out of view.
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(
            ([e]) => loop.setActive(e.isIntersecting),
            { threshold: 0 },
        ).observe(canvas);
    }
}
