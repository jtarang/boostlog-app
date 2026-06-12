/* Hero scene: a 3D boost-target map — the table every tuner stares at —
   rendered as a glowing wireframe surface with a live "pull" tracing
   across it. Three.js via CDN; the whole module is optional. */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.min.js';

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Surface dimensions (world units) — RPM along X, engine load along Y(depth).
const W = 26;
const D = 14;
const AMP = 3.4;

const smoothstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

// JS mirror of the GLSL height field (used for the pull trace).
function heightAt(px, py, time) {
    const rpm = Math.min(1, Math.max(0, px / W + 0.5));
    const load = Math.min(1, Math.max(0, py / D + 0.5));
    const rise = 1 / (1 + Math.exp(-10 * (rpm - 0.38)));
    const plateau = 1 - 0.42 * smoothstep(0.55, 1, rpm);
    const loadCurve = 0.25 + 0.75 * Math.pow(load, 1.4);
    let h = rise * plateau * loadCurve;
    h += 0.035 * Math.sin(rpm * 40) * Math.sin(load * 28);
    h += 0.05 * Math.sin(px * 0.7 + time * 0.6) * Math.sin(py * 0.9 + time * 0.45) * load;
    return h;
}

const VERT = (pointPass) => /* glsl */ `
    uniform float uTime;
    uniform float uDpr;
    uniform vec3 uColLow;
    uniform vec3 uColHigh;
    varying vec3 vColor;
    varying float vDepth;

    float heightAt(vec2 p) {
        float rpm = clamp(p.x / ${W.toFixed(1)} + 0.5, 0.0, 1.0);
        float load = clamp(p.y / ${D.toFixed(1)} + 0.5, 0.0, 1.0);
        float rise = 1.0 / (1.0 + exp(-10.0 * (rpm - 0.38)));
        float plateau = 1.0 - 0.42 * smoothstep(0.55, 1.0, rpm);
        float loadCurve = 0.25 + 0.75 * pow(load, 1.4);
        float h = rise * plateau * loadCurve;
        h += 0.035 * sin(rpm * 40.0) * sin(load * 28.0);
        h += 0.05 * sin(p.x * 0.7 + uTime * 0.6) * sin(p.y * 0.9 + uTime * 0.45) * load;
        return h;
    }

    void main() {
        vec3 pos = position;
        float h = heightAt(pos.xy);
        pos.z = h * ${AMP.toFixed(1)};

        float vH = clamp(h / 1.05, 0.0, 1.0);
        vColor = mix(uColLow, uColHigh, smoothstep(0.04, 0.92, vH));

        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vDepth = -mv.z;
        ${pointPass ? 'gl_PointSize = uDpr * (14.0 / max(1.0, -mv.z)) * (0.6 + 1.6 * vH);' : ''}
        gl_Position = projectionMatrix * mv;
    }
`;

const FRAG = (pointPass) => /* glsl */ `
    uniform float uAlpha;
    uniform float uFogNear;
    uniform float uFogFar;
    varying vec3 vColor;
    varying float vDepth;

    void main() {
        ${pointPass ? `
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float core = 1.0 - smoothstep(0.1, 0.5, d);
        ` : 'float core = 1.0;'}
        float fog = 1.0 - smoothstep(uFogNear, uFogFar, vDepth);
        gl_FragColor = vec4(vColor, uAlpha * core * fog);
    }
`;

function cssColor(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return new THREE.Color(v || fallback);
}

export function initScene(canvas) {
    if (!canvas) return;

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) {
        return; // no WebGL — static hero stands on its own
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dpr);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 80);

    const accent = cssColor('--accent', '#8338ec');
    const colLow = new THREE.Color('#171132');
    const colHigh = accent.clone();
    const colPointHigh = accent.clone().lerp(new THREE.Color('#ffffff'), 0.25);

    const isMobile = window.innerWidth < 768;
    const plane = new THREE.PlaneGeometry(W, D, isMobile ? 90 : 150, isMobile ? 54 : 90);

    const uniforms = (alpha, high) => ({
        uTime: { value: 0 },
        uDpr: { value: dpr },
        uAlpha: { value: alpha },
        uColLow: { value: colLow },
        uColHigh: { value: high },
        uFogNear: { value: 10 },
        uFogFar: { value: 30 },
    });

    const lineMat = new THREE.ShaderMaterial({
        uniforms: uniforms(0.34, colHigh),
        vertexShader: VERT(false),
        fragmentShader: FRAG(false),
        transparent: true,
        depthWrite: false,
    });

    const pointMat = new THREE.ShaderMaterial({
        uniforms: uniforms(0.85, colPointHigh),
        vertexShader: VERT(true),
        fragmentShader: FRAG(true),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    const group = new THREE.Group();
    group.rotation.x = -Math.PI / 2; // lay the map flat: local XY → world XZ
    group.position.y = -0.4;

    group.add(new THREE.LineSegments(new THREE.WireframeGeometry(plane), lineMat));
    group.add(new THREE.Points(plane, pointMat));
    scene.add(group);

    /* ── The pull: a live run tracing across the map ──────────────── */
    const TRACE_N = 160;
    const tracePos = new Float32Array(TRACE_N * 3);
    const traceGeo = new THREE.BufferGeometry();
    traceGeo.setAttribute('position', new THREE.BufferAttribute(tracePos, 3));
    traceGeo.setDrawRange(0, 0);
    const traceMat = new THREE.LineBasicMaterial({
        color: colPointHigh, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const trace = new THREE.Line(traceGeo, traceMat);
    group.add(trace);

    // glowing head of the trace
    const headCanvas = document.createElement('canvas');
    headCanvas.width = headCanvas.height = 64;
    const hctx = headCanvas.getContext('2d');
    const grad = hctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, `rgba(${Math.round(accent.r * 255)},${Math.round(accent.g * 255)},${Math.round(accent.b * 255)},0.9)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    hctx.fillStyle = grad;
    hctx.fillRect(0, 0, 64, 64);
    const head = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(headCanvas),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    head.scale.setScalar(0.9);
    scene.add(head);

    let runMaxLoad = 0.9;
    let runStart = 0;
    const RUN_DRAW = 2.8, RUN_HOLD = 0.8, RUN_FADE = 0.8;
    const RUN_TOTAL = RUN_DRAW + RUN_HOLD + RUN_FADE;

    function traceXY(s) {
        const rpm = 0.04 + s * 0.94;
        const load = Math.min(runMaxLoad, 0.28 + s * 2.1);
        return [(rpm - 0.5) * W, (load - 0.5) * D];
    }

    function updateTrace(time) {
        const t = (time - runStart) % RUN_TOTAL;
        if (time - runStart >= RUN_TOTAL) {
            runStart = time;
            runMaxLoad = 0.78 + Math.random() * 0.19;
        }

        for (let i = 0; i < TRACE_N; i++) {
            const s = i / (TRACE_N - 1);
            const [x, y] = traceXY(s);
            tracePos[i * 3] = x;
            tracePos[i * 3 + 1] = y;
            tracePos[i * 3 + 2] = heightAt(x, y, time) * AMP + 0.1;
        }
        traceGeo.attributes.position.needsUpdate = true;

        const drawP = Math.min(1, t / RUN_DRAW);
        const count = Math.max(2, Math.floor(drawP * TRACE_N));
        traceGeo.setDrawRange(0, count);

        const fadeP = t < RUN_DRAW + RUN_HOLD ? 0 : (t - RUN_DRAW - RUN_HOLD) / RUN_FADE;
        traceMat.opacity = 0.9 * (1 - fadeP);
        head.material.opacity = 1 - fadeP;

        // head position in world space (group is rotated -90° about X)
        const hi = (count - 1) * 3;
        head.position.set(tracePos[hi], tracePos[hi + 2] + group.position.y, -tracePos[hi + 1]);
    }

    /* ── Camera: scroll + pointer drift ───────────────────────────── */
    const look = new THREE.Vector3(0.6, 1.0, 0);
    const mouse = { x: 0, y: 0 };
    let scrollP = 0;

    window.addEventListener('pointermove', (e) => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    function readScroll() {
        const h = canvas.parentElement ? canvas.parentElement.offsetHeight : window.innerHeight;
        scrollP = Math.min(1, Math.max(0, window.scrollY / Math.max(1, h)));
    }
    window.addEventListener('scroll', readScroll, { passive: true });
    readScroll();

    camera.position.set(0, 4.4, 10.2);

    function placeCamera(time) {
        const driftX = Math.sin(time * 0.07) * 0.5;
        const tx = driftX + mouse.x * 1.1;
        const ty = 4.4 + scrollP * 3.4 - mouse.y * 0.45;
        const tz = 10.2 - scrollP * 2.6;
        camera.position.x += (tx - camera.position.x) * 0.035;
        camera.position.y += (ty - camera.position.y) * 0.045;
        camera.position.z += (tz - camera.position.z) * 0.045;
        look.y = 1.0 - scrollP * 1.1;
        camera.lookAt(look);
    }

    /* ── Sizing / lifecycle ───────────────────────────────────────── */
    function resize() {
        const w = canvas.clientWidth || window.innerWidth;
        const h = canvas.clientHeight || window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    const clock = new THREE.Clock();
    let elapsed = 0;
    let running = false;
    let rafId = null;

    function frame() {
        rafId = null;
        if (!running) return;
        elapsed += Math.min(clock.getDelta(), 0.05);

        lineMat.uniforms.uTime.value = elapsed;
        pointMat.uniforms.uTime.value = elapsed;
        updateTrace(elapsed);
        placeCamera(elapsed);

        renderer.render(scene, camera);
        rafId = requestAnimationFrame(frame);
    }

    function setRunning(on) {
        if (on === running) return;
        running = on;
        if (on) {
            clock.getDelta(); // swallow the pause
            if (!rafId) rafId = requestAnimationFrame(frame);
        }
    }

    if (REDUCED) {
        // One composed still: surface + a finished pull, no loop.
        elapsed = 1.4;
        lineMat.uniforms.uTime.value = elapsed;
        pointMat.uniforms.uTime.value = elapsed;
        runStart = elapsed - RUN_DRAW; // fully drawn
        updateTrace(elapsed);
        camera.lookAt(look);
        renderer.render(scene, camera);
        return;
    }

    const visObserver = new IntersectionObserver(
        ([entry]) => setRunning(entry.isIntersecting && !document.hidden),
        { threshold: 0.02 },
    );
    visObserver.observe(canvas);

    document.addEventListener('visibilitychange', () => {
        setRunning(!document.hidden);
    });

    setRunning(true);
}
