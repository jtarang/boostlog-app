/* Instrument-cluster hero background.
   A GSAP timeline simulates a WOT pull: RPM tachometer, boost gauge, AFR
   gauge, gear indicator, and speed readout animate through a realistic pull
   sequence and loop at idle. Pure canvas — no WebGL dependency. */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Tachometer arc geometry — standard 270° sweep, bottom-left to bottom-right.
const START_DEG = 135;
const SPAN_DEG  = 270;
const toRad = d => d * Math.PI / 180;

function valueToAngle(v, min, max) {
    return toRad(START_DEG + Math.max(0, Math.min(1, (v - min) / (max - min))) * SPAN_DEG);
}

function hexA(hex, a) {
    if (!hex || !hex.startsWith('#') || hex.length < 7) return `rgba(131,56,236,${a})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
}

// Shift hue of a hex color by `deg` degrees, return hsl string.
function shiftHue(hex, deg) {
    if (!hex || !hex.startsWith('#') || hex.length < 7) return hex;
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    h = (h + deg + 360) % 360;
    const l = (max + min) / 2;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return `hsl(${h.toFixed(0)},${(s * 100).toFixed(0)}%,${(l * 100).toFixed(0)}%)`;
}

export function initCluster(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const gsap = window.gsap;
    if (!gsap) return;

    // Palette from CSS vars — matches app theme.
    const css = getComputedStyle(document.documentElement);
    const accent = (css.getPropertyValue('--accent') || '#8338ec').trim();
    const colBoost = shiftHue(accent, 50);   // cyan-ish shift from accent
    const colAfr   = shiftHue(accent, -55);  // amber-ish shift

    // Animated state — GSAP writes directly into this object.
    const st = { rpm: 0, boost: -3, afr: 14.7, speed: 0, alpha: 0 };
    let gear = 'N';

    let W = 0, H = 0, raf = null;

    // ── DPI / sizing ───────────────────────────────────────────────────────
    function resize() {
        const dpr = window.devicePixelRatio || 1;
        W = canvas.offsetWidth  || window.innerWidth;
        H = canvas.offsetHeight || window.innerHeight;
        canvas.width  = W * dpr;
        canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ── Hex-grid background pattern ────────────────────────────────────────
    function drawHexGrid() {
        const size = 28, h = size * Math.sqrt(3);
        ctx.save();
        ctx.strokeStyle = hexA(accent, 0.04);
        ctx.lineWidth = 0.5;
        for (let row = -1; row < H / h + 2; row++) {
            for (let col = -1; col < W / (size * 3) + 2; col++) {
                const ox = col * size * 3 + (row % 2 ? size * 1.5 : 0);
                const oy = row * h;
                ctx.beginPath();
                for (let i = 0; i < 6; i++) {
                    const a = toRad(60 * i - 30);
                    const px = ox + size * Math.cos(a);
                    const py = oy + size * Math.sin(a);
                    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    // ── Single gauge (arc + ticks + needle + labels) ───────────────────────
    function drawGauge(cx, cy, r, {
        value, min, max,
        redlineAt = max * 0.88,
        color = accent,
        dangerColor = '#ff2d55',
        tickStep,
        majorEvery,
        labelFn = v => String(v),
        showNeedle = true,
        glowStrength = 20,
    }) {
        const startA  = toRad(START_DEG);
        const endA    = toRad(START_DEG + SPAN_DEG);
        const valA    = valueToAngle(value, min, max);
        const redA    = valueToAngle(redlineAt, min, max);
        const inRed   = value >= redlineAt;
        const activeCol = inRed ? dangerColor : color;

        // Track arc
        ctx.beginPath();
        ctx.arc(cx, cy, r, startA, endA);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = r * 0.044;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Redline zone highlight
        ctx.beginPath();
        ctx.arc(cx, cy, r, redA, endA);
        ctx.strokeStyle = hexA(dangerColor, 0.35);
        ctx.lineWidth = r * 0.044;
        ctx.stroke();

        // Live arc (0 → value)
        if (value > min) {
            ctx.save();
            ctx.shadowColor = activeCol;
            ctx.shadowBlur = glowStrength;
            ctx.beginPath();
            ctx.arc(cx, cy, r, startA, valA);
            ctx.strokeStyle = activeCol;
            ctx.lineWidth = r * 0.048;
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.restore();
        }

        // Tick marks + labels
        for (let v = min; v <= max + 0.001; v += tickStep) {
            const a = valueToAngle(v, min, max);
            const major = majorEvery && Math.round(v / majorEvery) * majorEvery === Math.round(v);
            const outerR = r * 0.945;
            const innerR = r * (major ? 0.76 : 0.855);
            const inTickRed = v >= redlineAt;

            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * innerR, cy + Math.sin(a) * innerR);
            ctx.lineTo(cx + Math.cos(a) * outerR, cy + Math.sin(a) * outerR);
            ctx.strokeStyle = inTickRed
                ? hexA(dangerColor, 0.75)
                : `rgba(255,255,255,${major ? 0.65 : 0.22})`;
            ctx.lineWidth = major ? r * 0.024 : r * 0.01;
            ctx.stroke();

            if (major) {
                const labelR = r * 0.635;
                ctx.save();
                ctx.font = `500 ${Math.round(r * 0.125)}px "JetBrains Mono", monospace`;
                ctx.fillStyle = inTickRed
                    ? hexA(dangerColor, 0.9)
                    : 'rgba(255,255,255,0.5)';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(labelFn(v), cx + Math.cos(a) * labelR, cy + Math.sin(a) * labelR);
                ctx.restore();
            }
        }

        // Needle
        if (showNeedle) {
            const needleLen  = r * 0.80;
            const tailLen    = r * 0.16;
            const baseHalf   = r * 0.026;
            const tipHalf    = r * 0.006;

            ctx.save();
            ctx.shadowColor = activeCol;
            ctx.shadowBlur = 22;

            const tx = cx + Math.cos(valA) * needleLen;
            const ty = cy + Math.sin(valA) * needleLen;
            const bx = cx + Math.cos(valA + Math.PI) * tailLen;
            const by = cy + Math.sin(valA + Math.PI) * tailLen;
            const px = Math.cos(valA + Math.PI / 2);
            const py = Math.sin(valA + Math.PI / 2);

            ctx.beginPath();
            ctx.moveTo(tx + px * tipHalf,   ty + py * tipHalf);
            ctx.lineTo(bx + px * baseHalf,  by + py * baseHalf);
            ctx.lineTo(bx - px * baseHalf,  by - py * baseHalf);
            ctx.lineTo(tx - px * tipHalf,   ty - py * tipHalf);
            ctx.closePath();
            ctx.fillStyle = activeCol;
            ctx.fill();
            ctx.restore();

            // Centre hub cap
            ctx.save();
            ctx.shadowColor = activeCol;
            ctx.shadowBlur = 14;
            const hubR = r * 0.058;
            const hubGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, hubR);
            hubGrad.addColorStop(0, 'rgba(255,255,255,0.95)');
            hubGrad.addColorStop(0.45, hexA(activeCol, 0.85));
            hubGrad.addColorStop(1,    hexA(activeCol, 0.2));
            ctx.beginPath();
            ctx.arc(cx, cy, hubR, 0, Math.PI * 2);
            ctx.fillStyle = hubGrad;
            ctx.fill();
            ctx.restore();
        }
    }

    // ── Main tachometer with digital RPM + gear ghost ──────────────────────
    function drawTach(cx, cy, r) {
        drawGauge(cx, cy, r, {
            value: st.rpm, min: 0, max: 8000,
            redlineAt: 6500,
            color: accent,
            tickStep: 500,
            majorEvery: 1000,
            labelFn: v => v >= 1000 ? String(v / 1000) : String(v),
            glowStrength: 28,
        });

        // Ghost gear character behind needle hub
        ctx.save();
        ctx.font = `900 ${r * 0.34}px "Outfit", "Chakra Petch", sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(gear, cx, cy - r * 0.06);
        ctx.restore();

        // Digital RPM readout below centre
        const rpmRound = Math.round(st.rpm);
        ctx.save();
        ctx.font = `700 ${r * 0.195}px "JetBrains Mono", monospace`;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = accent;
        ctx.shadowBlur = 20;
        ctx.fillText(rpmRound.toLocaleString('en-US').replace(/,/g, ' '), cx, cy + r * 0.31);
        ctx.restore();

        ctx.save();
        ctx.font = `${r * 0.096}px "JetBrains Mono", monospace`;
        ctx.fillStyle = hexA(accent, 0.45);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('RPM', cx, cy + r * 0.46);
        ctx.restore();
    }

    // ── Mini gauge (boost or AFR) with centred digital ─────────────────────
    function drawMini(cx, cy, r, { value, min, max, redlineAt, color, dangerColor, tickStep, majorEvery, labelFn, unit, name }) {
        drawGauge(cx, cy, r, { value, min, max, redlineAt, color, dangerColor, tickStep, majorEvery, labelFn, glowStrength: 14 });

        // Digital centre value
        const display = Number.isInteger(value) ? String(value) : value.toFixed(1);
        ctx.save();
        ctx.font = `700 ${r * 0.26}px "JetBrains Mono", monospace`;
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fillText(display, cx, cy + r * 0.3);
        ctx.restore();

        ctx.save();
        ctx.font = `${r * 0.165}px "JetBrains Mono", monospace`;
        ctx.fillStyle = hexA(color, 0.5);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(unit, cx, cy + r * 0.505);
        ctx.restore();

        // Gauge name, bottom
        ctx.save();
        ctx.font = `500 ${r * 0.135}px "JetBrains Mono", monospace`;
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, cx, cy + r * 0.68);
        ctx.restore();
    }

    // ── Speed + gear readout strip ──────────────────────────────────────────
    function drawInfoStrip(cx, cy, mainR) {
        const items = [
            { val: Math.round(st.speed) + ' mph', sub: 'SPEED',  col: 'rgba(255,255,255,0.7)' },
            { val: gear,                           sub: 'GEAR',   col: hexA(accent, 0.85) },
        ];
        const gap = mainR * 0.58;
        items.forEach((item, i) => {
            const x = cx + (i === 0 ? -gap : gap);
            ctx.save();
            ctx.textAlign = 'center';
            ctx.font = `700 ${mainR * 0.155}px "JetBrains Mono", monospace`;
            ctx.fillStyle = item.col;
            ctx.shadowColor = item.col;
            ctx.shadowBlur = 10;
            ctx.fillText(item.val, x, cy);
            ctx.shadowBlur = 0;
            ctx.font = `${mainR * 0.09}px "JetBrains Mono", monospace`;
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.fillText(item.sub, x, cy + mainR * 0.2);
            ctx.restore();
        });
    }

    // ── Connector lines between gauges ─────────────────────────────────────
    function drawConnectors(tacoCx, tacoCy, bCx, bCy, aCx, aCy, mainR, miniR) {
        ctx.save();
        ctx.strokeStyle = hexA(accent, 0.1);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 9]);
        // Left
        ctx.beginPath();
        ctx.moveTo(bCx + miniR * 0.88, bCy);
        ctx.lineTo(tacoCx - mainR * 0.71, tacoCy);
        ctx.stroke();
        // Right
        ctx.beginPath();
        ctx.moveTo(aCx - miniR * 0.88, aCy);
        ctx.lineTo(tacoCx + mainR * 0.71, tacoCy);
        ctx.stroke();
        ctx.restore();
    }

    // ── HUD corner brackets ────────────────────────────────────────────────
    function drawCorners() {
        const m = 22, len = 28, t = 1.5;
        const pts = [[m, m], [W - m, m], [W - m, H - m], [m, H - m]];
        const dirs = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
        ctx.save();
        ctx.strokeStyle = hexA(accent, 0.25);
        ctx.lineWidth = t;
        pts.forEach(([x, y], i) => {
            const [dx, dy] = dirs[i];
            ctx.beginPath();
            ctx.moveTo(x + dx * len, y);
            ctx.lineTo(x, y);
            ctx.lineTo(x, y + dy * len);
            ctx.stroke();
        });
        ctx.restore();
    }

    // ── Master draw ────────────────────────────────────────────────────────
    function draw() {
        ctx.clearRect(0, 0, W, H);

        const alpha = Math.max(0, Math.min(1, st.alpha));
        if (alpha === 0) {
            // Fully faded — stop the loop to save GPU/battery.
            raf = null;
            return;
        }

        ctx.save();
        ctx.globalAlpha = alpha;

        drawHexGrid();
        drawCorners();

        // Layout — scales with viewport
        const mainR  = Math.min(W * 0.24, H * 0.44, 260);
        const tacoCx = W * 0.5;
        const tacoCy = H * 0.545;
        const miniR  = mainR * 0.385;
        const bCx    = W * 0.185;
        const bCy    = H * 0.545;
        const aCx    = W * 0.815;
        const aCy    = H * 0.545;

        // Ambient glow behind tach
        const glow = ctx.createRadialGradient(tacoCx, tacoCy, 0, tacoCx, tacoCy, mainR * 1.5);
        glow.addColorStop(0,    hexA(accent, 0.09));
        glow.addColorStop(0.55, hexA(accent, 0.03));
        glow.addColorStop(1,    'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);

        drawConnectors(tacoCx, tacoCy, bCx, bCy, aCx, aCy, mainR, miniR);

        drawTach(tacoCx, tacoCy, mainR);

        drawMini(bCx, bCy, miniR, {
            value:      st.boost,
            min: -10, max: 25, redlineAt: 22,
            color:      colBoost,
            dangerColor: '#ff2d55',
            tickStep: 5, majorEvery: 10,
            labelFn: v => String(v),
            unit: 'PSI', name: 'BOOST',
        });

        drawMini(aCx, aCy, miniR, {
            value:      parseFloat(st.afr.toFixed(1)),
            min: 10, max: 17, redlineAt: 15.8,
            color:      colAfr,
            dangerColor: '#ff9500',
            tickStep: 1, majorEvery: 2,
            labelFn: v => String(v),
            unit: 'AFR', name: 'LAMBDA',
        });

        drawInfoStrip(tacoCx, tacoCy + mainR * 0.82, mainR);

        ctx.restore();

        raf = requestAnimationFrame(draw);
    }

    // ── GSAP pull sequence ─────────────────────────────────────────────────
    function runSequence() {
        const ease = 'power3.out';

        function onePull() {
            const tl = gsap.timeline({
                onComplete: () => gsap.delayedCall(2.0, onePull),
            });

            // Idle
            tl.to(st, { rpm: 840, boost: -2.5, afr: 14.7, speed: 0, duration: 0.6, ease });

            // Stage 1 — first gear launch
            tl.add(() => { gear = '1'; });
            tl.to(st, { rpm: 6900, boost: 13.5, afr: 12.4, speed: 26, duration: 1.0, ease: 'power2.in' });

            // Gear shift 1→2 (RPM drop)
            tl.add(() => { gear = '2'; });
            tl.to(st, { rpm: 4100, boost: 14.8, duration: 0.14, ease: 'none' });

            // Stage 2 — second gear
            tl.to(st, { rpm: 7100, boost: 17.8, afr: 11.9, speed: 54, duration: 1.05, ease: 'power2.inOut' });

            // Gear shift 2→3
            tl.add(() => { gear = '3'; });
            tl.to(st, { rpm: 4400, boost: 18.2, duration: 0.13, ease: 'none' });

            // Stage 3 — third gear, near peak
            tl.to(st, { rpm: 7250, boost: 19.4, afr: 11.5, speed: 88, duration: 1.15, ease: 'power2.inOut' });

            // Hold at peak
            tl.to(st, { rpm: 7180, boost: 19.1, duration: 0.55, ease: 'sine.inOut' });

            // Lift off
            tl.to(st, { rpm: 2600, boost: 1.8, afr: 14.3, speed: 72, duration: 1.6, ease: 'power3.in' });
            tl.add(() => { gear = 'N'; });
            tl.to(st, { rpm: 860,  boost: -2.5, afr: 14.7, speed: 58, duration: 0.9, ease });
        }

        // Startup: boot sweep (needles full deflection then back to idle)
        gsap.to(st, { alpha: 1, duration: 1.0, ease: 'power2.out' });
        const boot = gsap.timeline({ delay: 0.4 });
        boot.to(st, { rpm: 8000, boost: 25, afr: 10, speed: 0, duration: 0.7, ease: 'power2.inOut' });
        boot.to(st, { rpm: 0,    boost: -10, afr: 17, speed: 0, duration: 0.5, ease: 'power3.out' });
        boot.to(st, { rpm: 840, boost: -2.5, afr: 14.7, duration: 0.5, ease });

        // Fade out as the hero headline and graph animate in (hero starts at ~1.4s,
        // graph rises at ~1.7s — cluster is fully gone by the time content settles).
        gsap.to(st, { alpha: 0, duration: 1.4, delay: 1.5, ease: 'power2.in' });
    }

    // ── Reduced-motion path ────────────────────────────────────────────────
    function runReduced() {
        st.alpha = 0.6;
        st.rpm   = 4200;
        st.boost = 12;
        st.afr   = 12.8;
        st.speed = 55;
        gear     = '3';
        // Draw once, no loop.
        draw();
        if (raf) cancelAnimationFrame(raf);
    }

    // ── Visibility-aware loop ──────────────────────────────────────────────
    let running = false;
    function setRunning(on) {
        if (on === running) return;
        running = on;
        if (on && !raf) raf = requestAnimationFrame(draw);
        if (!on && raf) { cancelAnimationFrame(raf); raf = null; }
    }

    resize();
    window.addEventListener('resize', resize, { passive: true });

    if (REDUCED) {
        runReduced();
        return;
    }

    new IntersectionObserver(
        ([e]) => setRunning(e.isIntersecting),
        { threshold: 0.02 },
    ).observe(canvas);
    document.addEventListener('visibilitychange', () => setRunning(!document.hidden));

    setRunning(true);
    runSequence();
}
