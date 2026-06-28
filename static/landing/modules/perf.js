/* Shared performance helpers for the landing animations.

   Every canvas/WebGL loop on this page used to run uncapped at the display's
   refresh rate, which only stays smooth on fast hardware. These helpers let
   each loop (a) detect a weak device and scale work down, and (b) hold a
   target frame budget instead of rendering as fast as the GPU will allow. */

export const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Best-effort "is this a low-power device?" guess. None of these signals is
   authoritative on its own, so we combine them conservatively: a machine that
   reports little memory, few cores, or a coarse (touch) pointer is treated as
   low power and gets the cheaper render path. */
export const LOW_POWER = (() => {
    const mem = navigator.deviceMemory;          // GiB, Chrome-only, coarse
    const cores = navigator.hardwareConcurrency; // logical cores, widely supported
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (typeof mem === 'number' && mem <= 4) return true;
    if (typeof cores === 'number' && cores <= 4) return true;
    // Phones/tablets: coarse pointer + small viewport.
    if (coarse && Math.min(window.innerWidth, window.innerHeight) < 820) return true;
    return false;
})();

/* A frame gate that lets a rAF loop hold ~targetFps instead of running flat
   out. Call shouldRender(now) once per rAF tick; it returns true only when
   enough time has elapsed for the next frame. This caps GPU/CPU cost (and
   battery drain) without changing the visible motion's speed, since the loops
   advance their own clocks by real elapsed time.

   On low-power devices the cap is lowered automatically. */
export function frameGate(targetFps) {
    const fps = LOW_POWER ? Math.min(targetFps, 24) : targetFps;
    const interval = 1000 / fps;
    let last = -Infinity;
    return function shouldRender(now) {
        if (now - last < interval) return false;
        // Snap `last` to the grid so we don't drift slower than the target.
        last = now - ((now - last) % interval);
        return true;
    };
}

/* Run `onFrame(now)` in a rAF loop that is gated to `fps`, and automatically
   paused whenever the tab is hidden. Returns a stop() function.

   `onVisible`/`onHidden` (optional) let the caller add its own gating, e.g. an
   IntersectionObserver, by calling the returned controller's setActive(). */
export function gatedLoop(onFrame, { fps = 60 } = {}) {
    const gate = frameGate(fps);
    let rafId = null;
    let active = true;   // caller-controlled (e.g. on-screen)
    let visible = !document.hidden;

    function tick(now) {
        rafId = null;
        if (!active || !visible) return;
        if (gate(now)) onFrame(now);
        rafId = requestAnimationFrame(tick);
    }
    function ensureRunning() {
        if (rafId == null && active && visible) rafId = requestAnimationFrame(tick);
    }
    function stopRaf() {
        if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    const onVis = () => { visible = !document.hidden; visible ? ensureRunning() : stopRaf(); };
    document.addEventListener('visibilitychange', onVis);

    ensureRunning();

    return {
        setActive(on) { active = on; on ? ensureRunning() : stopRaf(); },
        stop() {
            active = false;
            stopRaf();
            document.removeEventListener('visibilitychange', onVis);
        },
    };
}
