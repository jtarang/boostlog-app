/* Background module: Fluctuating graph line and particles */

export function initBackground(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let w, h;
    function resize() {
        w = window.innerWidth;
        h = window.innerHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
    }
    window.addEventListener('resize', resize);
    resize();

    let time = 0;
    let rafId;

    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8338ec';
    const cyanColor = getComputedStyle(document.documentElement).getPropertyValue('--cyan').trim() || '#54e2ff';
    const amberColor = getComputedStyle(document.documentElement).getPropertyValue('--amber').trim() || '#ffb454';

    function render() {
        time += 0.012;
        ctx.clearRect(0, 0, w, h);

        // Draw fluctuating graph lines
        const drawLine = (offsetY, ampMult, freqMult, color, alpha, glow, speedMult) => {
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            if (glow) {
                ctx.shadowBlur = 12;
                ctx.shadowColor = color;
            } else {
                ctx.shadowBlur = 0;
            }
            
            ctx.beginPath();
            let started = false;
            
            for (let x = -50; x <= w + 50; x += 5) {
                const nx = x / w;
                const t = time * speedMult;
                
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
                
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        };

        drawLine(0.5, 1.0, 1.0, accentColor, 0.45, true, 1.0); // Main line
        drawLine(0.65, 0.7, 1.3, cyanColor, 0.25, false, 0.85); // Secondary cyan line
        drawLine(0.35, 0.5, 0.8, amberColor, 0.2, false, 1.15); // Tertiary amber line

        ctx.globalAlpha = 1.0;
        rafId = requestAnimationFrame(render);
    }

    // Start rendering if not reduced motion
    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!REDUCED) {
        render();
    } else {
        // Just draw one static frame
        time = 45.0; // arbitrary time for a nice looking static wave
        render();
        cancelAnimationFrame(rafId);
    }
}
