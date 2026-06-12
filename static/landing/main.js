/* boostLog landing — interaction & motion.
   GSAP loads from CDN as a classic script; everything here degrades to a
   fully static (visible) page if it's missing or reduced-motion is set. */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const gsapOk = () => typeof window.gsap !== 'undefined';
const MOTION = () => gsapOk() && !REDUCED;

function registerPlugins() {
    if (gsapOk() && window.ScrollTrigger) window.gsap.registerPlugin(window.ScrollTrigger);
}

/* ── Nav: scrolled state + mobile panel ───────────────────────────── */
function initNav() {
    const nav = document.getElementById('nav');
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const burger = document.getElementById('navBurger');
    const panel = document.getElementById('mobileNav');
    if (!burger || !panel) return;

    const setOpen = (open) => {
        burger.classList.toggle('open', open);
        burger.setAttribute('aria-expanded', String(open));
        panel.classList.toggle('open', open);
        panel.setAttribute('aria-hidden', String(!open));
    };

    burger.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
    panel.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel.classList.contains('open')) setOpen(false);
    });
}

/* ── Gear indicator: page scroll mapped to a 6-speed box ─────────── */
function initGearbox() {
    const label = document.getElementById('gearLabel');
    const fill = document.getElementById('gearFill');
    if (!label || !fill) return;

    let lastGear = null;
    let raf = null;

    const update = () => {
        raf = null;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
        const gear = p < 0.004 ? 'N' : String(Math.min(6, Math.floor(p * 6) + 1));
        const within = p >= 1 ? 1 : (p * 6) % 1;
        fill.style.width = `${(gear === 'N' ? 0 : within) * 100}%`;
        if (gear !== lastGear) {
            lastGear = gear;
            label.textContent = gear;
            if (MOTION()) {
                window.gsap.fromTo(label, { scale: 1.45, color: '#ffffff' },
                    { scale: 1, duration: 0.35, ease: 'power3.out', clearProps: 'color', overwrite: true });
            }
        }
    };

    window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    update();
}

/* ── Hero: headline split + entrance + HUD flicker ────────────────── */
function splitChars(el) {
    // Words become unbreakable inline-blocks so lines never wrap mid-word.
    const words = el.textContent.split(' ');
    el.textContent = '';
    const frag = document.createDocumentFragment();
    words.forEach((word, w) => {
        const wordSpan = document.createElement('span');
        wordSpan.className = 'word';
        for (const ch of word) {
            const span = document.createElement('span');
            span.className = 'char';
            span.textContent = ch;
            wordSpan.appendChild(span);
        }
        frag.appendChild(wordSpan);
        if (w < words.length - 1) frag.appendChild(document.createTextNode(' '));
    });
    el.appendChild(frag);
    return el.querySelectorAll('.char');
}

function initHero() {
    const rig = document.getElementById('startLights');
    const lights = Array.from(document.querySelectorAll('#startLights .start-light'));

    if (!MOTION()) {
        // No sequence to play — don't show an inert rig.
        if (rig) rig.style.display = 'none';
        return;
    }
    const gsap = window.gsap;

    const lines = document.querySelectorAll('.hero-title [data-split]');
    const allChars = [];
    lines.forEach(line => allChars.push(...splitChars(line)));

    const rises = document.querySelectorAll('.hero [data-rise]');
    const hudItems = document.querySelectorAll('.hero .hud-item');
    const corners = document.querySelectorAll('.hero .hud-corner');
    const eyebrow = document.querySelector('.hero-eyebrow');
    const strip = document.getElementById('heroStrip');

    gsap.set(allChars, { yPercent: 112 });
    gsap.set(rises, { autoAlpha: 0, y: 22 });
    gsap.set([...hudItems, ...corners], { autoAlpha: 0 });
    gsap.set(eyebrow, { autoAlpha: 0 });
    gsap.set(strip, { autoAlpha: 0, y: 14 });

    const tl = gsap.timeline({ defaults: { ease: 'power4.out' }, delay: 0.1 });

    // Race start: five reds at the top of the page…
    lights.forEach((light, i) => tl.add(() => light.classList.add('on'), 0.18 * (i + 1)));
    const OUT = 0.18 * lights.length + 0.5; // …and it's lights out.

    // The cell wakes up around the rig while the lights run
    tl.to(eyebrow, { autoAlpha: 1, duration: 0.05, repeat: 5, repeatDelay: 0.07, yoyo: true }, 0.35)
        .to(eyebrow, { autoAlpha: 1, duration: 0.1 }, 0.85)
        .to([...corners, ...hudItems], { autoAlpha: 1, duration: 0.5, stagger: 0.06 }, 0.5)
        .to(strip, { autoAlpha: 1, y: 0, duration: 0.7 }, 0.85);

    // Lights out — back to clear, F1 style — and launch the headline
    tl.add(() => lights.forEach(l => l.classList.remove('on')), OUT)
        .to(allChars, { yPercent: 0, duration: 1.0, stagger: 0.022 }, OUT)
        .to(rises, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.12 }, OUT + 0.3)
        .to(rig, { autoAlpha: 0, duration: 0.6 }, OUT + 1.1);
}

/* ── Hero strip: live telemetry readouts ──────────────────────────── */
function initTicker() {
    const elBoost = document.getElementById('tickBoost');
    const elAfr = document.getElementById('tickAfr');
    const elRpm = document.getElementById('tickRpm');
    const elIat = document.getElementById('tickIat');
    if (!elBoost || REDUCED) return;

    const SHIFT_AT = 6800, DROP_TO = 3600, START = 2300;
    let rpm = START, last = 0, iatPhase = Math.random() * 7;

    const fmtRpm = (v) => Math.round(v).toLocaleString('en-US').replace(/,/g, ' ');

    function frame(now) {
        if (now - last > 90) {
            last = now;
            rpm += 110 + Math.random() * 60;
            if (rpm > SHIFT_AT) rpm = DROP_TO + Math.random() * 250;
            const load = (rpm - START) / (SHIFT_AT - START);
            const boost = 5.5 + load * 12.9 + (Math.random() - 0.5) * 0.5;
            const afr = 12.9 - load * 1.7 + (Math.random() - 0.5) * 0.2;
            iatPhase += 0.013;
            const iat = 31.5 + Math.sin(iatPhase) * 3.2 + (Math.random() - 0.5) * 0.3;

            elRpm.textContent = fmtRpm(rpm);
            elBoost.textContent = boost.toFixed(1);
            elAfr.textContent = afr.toFixed(1);
            elIat.textContent = iat.toFixed(1);
        }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

/* ── Marquee: duplicate the set so the CSS loop is seamless ───────── */
function initMarquee() {
    const track = document.getElementById('marqueeTrack');
    if (!track) return;
    track.appendChild(track.querySelector('.marquee-set').cloneNode(true));
}

/* ── Generic scroll reveals ───────────────────────────────────────── */
function initReveals() {
    if (!MOTION()) return;
    const gsap = window.gsap;

    document.querySelectorAll('.sec-head').forEach(head => {
        const kids = head.children;
        gsap.set(kids, { autoAlpha: 0, y: 26 });
        window.ScrollTrigger.create({
            trigger: head,
            start: 'top 82%',
            once: true,
            onEnter: () => gsap.to(kids, { autoAlpha: 1, y: 0, duration: 0.85, stagger: 0.1, ease: 'power3.out' }),
        });
    });

    gsap.utils.toArray('[data-rise]:not(.hero [data-rise])').forEach(el => {
        gsap.set(el, { autoAlpha: 0, y: 30 });
        window.ScrollTrigger.create({
            trigger: el,
            start: 'top 86%',
            once: true,
            onEnter: () => gsap.to(el, { autoAlpha: 1, y: 0, duration: 0.9, ease: 'power3.out' }),
        });
    });

    const cards = gsap.utils.toArray('[data-card]');
    gsap.set(cards, { autoAlpha: 0, y: 24 });
    window.ScrollTrigger.batch(cards, {
        start: 'top 88%',
        once: true,
        onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out' }),
    });
}

/* ── Count-up metrics ─────────────────────────────────────────────── */
function setCounterFinal(el) {
    const target = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.decimals || '0', 10);
    el.textContent = dec > 0 ? target.toFixed(dec) : Math.round(target).toLocaleString('en-US');
}

function initCounters() {
    const els = document.querySelectorAll('[data-count]');
    if (!MOTION()) {
        els.forEach(setCounterFinal);
        return;
    }
    const gsap = window.gsap;
    els.forEach(el => {
        const target = parseFloat(el.dataset.count);
        const dec = parseInt(el.dataset.decimals || '0', 10);
        const obj = { v: 0 };
        window.ScrollTrigger.create({
            trigger: el,
            start: 'top 90%',
            once: true,
            onEnter: () => gsap.to(obj, {
                v: target,
                duration: 1.4,
                ease: 'power2.out',
                onUpdate: () => {
                    el.textContent = dec > 0 ? obj.v.toFixed(dec) : Math.round(obj.v).toLocaleString('en-US');
                },
            }),
        });
    });
}

/* ── Workflow: scrubbed rail + step reveals ───────────────────────── */
function initWorkflow() {
    if (!MOTION()) return;
    const gsap = window.gsap;
    const rail = document.getElementById('howRail');
    const how = document.querySelector('.how');
    if (rail && how) {
        gsap.to(rail, {
            scaleY: 1,
            ease: 'none',
            scrollTrigger: { trigger: how, start: 'top 72%', end: 'bottom 55%', scrub: 0.4 },
        });
    }
    gsap.utils.toArray('[data-step]').forEach(step => {
        const body = step.querySelector('.step-body');
        const term = step.querySelector('.term');
        const ghost = step.querySelector('.step-ghost');
        gsap.set([body, term], { autoAlpha: 0, y: 36 });
        gsap.set(ghost, { autoAlpha: 0, x: -22 });
        window.ScrollTrigger.create({
            trigger: step,
            start: 'top 78%',
            once: true,
            onEnter: () => {
                gsap.to(ghost, { autoAlpha: 1, x: 0, duration: 0.9, ease: 'power3.out' });
                gsap.to([body, term], { autoAlpha: 1, y: 0, duration: 0.85, stagger: 0.14, ease: 'power3.out' });
            },
        });
    });
}

/* ── Turbo chat: replayed conversation ────────────────────────────── */
function initChat() {
    if (!MOTION()) return;
    const gsap = window.gsap;
    const term = document.getElementById('aiTerm');
    const msgs = gsap.utils.toArray('#aiMessages [data-type]');
    if (!term || !msgs.length) return;

    gsap.set(msgs, { autoAlpha: 0, y: 14 });

    const makeTyping = () => {
        const t = document.createElement('div');
        t.className = 'msg-ai';
        t.style.padding = '13px 16px';
        t.innerHTML = '<span>·</span><span>·</span><span>·</span>';
        t.querySelectorAll('span').forEach(s => {
            s.style.cssText = 'display:inline-block;margin-right:6px;font-weight:700;color:var(--accent)';
        });
        return t;
    };

    window.ScrollTrigger.create({
        trigger: term,
        start: 'top 72%',
        once: true,
        onEnter: () => {
            const tl = gsap.timeline();
            msgs.forEach((msg) => {
                const isAi = msg.classList.contains('msg-ai');
                if (isAi) {
                    let typing;
                    tl.add(() => {
                        typing = makeTyping();
                        msg.parentNode.insertBefore(typing, msg);
                        gsap.to(typing.querySelectorAll('span'), {
                            opacity: 0.25, repeat: -1, yoyo: true, duration: 0.4, stagger: 0.14,
                        });
                    });
                    tl.to({}, { duration: 1.0 });
                    tl.add(() => { gsap.killTweensOf(typing.querySelectorAll('span')); typing.remove(); });
                }
                tl.to(msg, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power3.out' });
                tl.to({}, { duration: isAi ? 0.55 : 0.4 });
            });
        },
    });
}

/* ── CTA reveal ───────────────────────────────────────────────────── */
function initCtaReveal() {
    const title = document.getElementById('ctaTitle');
    const sub = document.querySelector('.cta-sub');
    const btns = document.querySelector('.cta-btns');
    if (!MOTION() || !title) return;

    const gsap = window.gsap;
    gsap.set([title, sub, btns], { autoAlpha: 0, y: 30 });
    window.ScrollTrigger.create({
        trigger: '#cta',
        start: 'top 70%',
        once: true,
        onEnter: () => gsap.to([title, sub, btns], {
            autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.09, ease: 'back.out(1.6)',
        }),
    });
}

/* ── FAQ accordion ────────────────────────────────────────────────── */
function initFaq() {
    const items = document.querySelectorAll('#faqList .faq-item');

    const close = (item) => {
        const a = item.querySelector('.faq-a');
        item.classList.remove('open');
        item.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
        if (MOTION()) {
            window.gsap.to(a, { height: 0, duration: 0.4, ease: 'power3.inOut' });
        } else {
            a.style.height = '0px';
        }
    };

    const open = (item) => {
        const a = item.querySelector('.faq-a');
        item.classList.add('open');
        item.querySelector('.faq-q').setAttribute('aria-expanded', 'true');
        if (MOTION()) {
            window.gsap.to(a, {
                height: a.scrollHeight, duration: 0.45, ease: 'power3.inOut',
                onComplete: () => { a.style.height = 'auto'; },
            });
        } else {
            a.style.height = 'auto';
        }
    };

    items.forEach(item => {
        item.querySelector('.faq-q').addEventListener('click', () => {
            const isOpen = item.classList.contains('open');
            items.forEach(other => { if (other !== item && other.classList.contains('open')) close(other); });
            isOpen ? close(item) : open(item);
        });
    });
}

/* ── Boot ─────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    registerPlugins();

    initNav();
    initGearbox();
    initMarquee();
    initHero();
    initTicker();
    initReveals();
    initCounters();
    initWorkflow();
    initChat();
    initCtaReveal();
    initFaq();

    // 3D boost-map hero (Three.js) — optional enhancement, never fatal.
    import('./modules/scene.js?v=7.1')
        .then(m => m.initScene(document.getElementById('apexScene')))
        .catch(() => { /* WebGL/CDN unavailable — static hero stays */ });

    // Telemetry instrument canvas
    import('./modules/datalog.js?v=7.1')
        .then(m => m.initTelemetry())
        .catch(() => { /* canvas stays empty behind metrics */ });
});
