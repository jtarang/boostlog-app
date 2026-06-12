// Auth-screen backdrop: a night dyno cell — receding floor grid + drifting
// particles, rendered with Three.js behind the login card. Loaded lazily;
// completely optional. Pauses and frees the GPU once the user is signed in.

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export async function initAuthFx() {
    const canvas = document.getElementById('authFx');
    const overlay = document.getElementById('authOverlay');
    if (!canvas || !overlay) return;

    let THREE;
    try {
        THREE = await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.min.js');
    } catch (e) {
        return;
    }

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch (e) {
        return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x07090a, 6, 34);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 60);
    camera.position.set(0, 1.6, 9);

    const accentCss = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8338ec';
    const accent = new THREE.Color(accentCss);

    // Floor grid
    const grid = new THREE.GridHelper(60, 60, accent, new THREE.Color(0x1f1a30));
    grid.material.transparent = true;
    grid.material.opacity = 0.32;
    grid.position.y = -1.4;
    scene.add(grid);

    // Drifting particles
    const COUNT = 320;
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 40;
        pos[i * 3 + 1] = Math.random() * 10 - 1;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pMat = new THREE.PointsMaterial({
        color: accent, size: 0.05, transparent: true, opacity: 0.7,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    const mouse = { x: 0, y: 0 };
    window.addEventListener('pointermove', (e) => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    function resize() {
        const w = overlay.clientWidth || window.innerWidth;
        const h = overlay.clientHeight || window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    let running = false;
    let rafId = null;
    let t = 0;
    let disposed = false;

    function frame() {
        rafId = null;
        if (!running || disposed) return;
        t += 0.016;

        grid.position.z = (t * 0.8) % 1; // conveyor: floor slides toward camera
        particles.rotation.y = t * 0.02;
        camera.position.x += (mouse.x * 0.8 - camera.position.x) * 0.03;
        camera.position.y += (1.6 - mouse.y * 0.4 - camera.position.y) * 0.03;
        camera.lookAt(0, 0.6, 0);

        renderer.render(scene, camera);
        rafId = requestAnimationFrame(frame);
    }

    function setRunning(on) {
        if (disposed || on === running) return;
        running = on;
        if (on && !rafId) rafId = requestAnimationFrame(frame);
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        running = false;
        pGeo.dispose();
        pMat.dispose();
        grid.geometry.dispose();
        grid.material.dispose();
        renderer.dispose();
    }

    if (REDUCED) {
        renderer.render(scene, camera);
        return;
    }

    // Run only while the auth overlay is on screen; free GPU after login.
    const check = () => {
        const shown = overlay.style.display !== 'none' && getComputedStyle(overlay).display !== 'none';
        if (shown) {
            resize();
            setRunning(!document.hidden);
        } else {
            setRunning(false);
            // user is in — tear down after the overlay fade
            setTimeout(dispose, 1200);
            mo.disconnect();
        }
    };
    const mo = new MutationObserver(check);
    mo.observe(overlay, { attributes: true, attributeFilter: ['style'] });
    document.addEventListener('visibilitychange', () => { if (!disposed) setRunning(!document.hidden); });
    check();
}
