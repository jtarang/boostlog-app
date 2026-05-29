import { initHeroChart } from './modules/hero.js';
import { initFaq } from './modules/faq.js';
import { initTweaks } from './modules/tweaks.js';

// ── Theme (light / dark) ──────────────────────────────────────────
const THEME_KEY = 'bl_theme';

function syncThemeUI(theme) {
    document.querySelectorAll('[data-theme-icon]').forEach(el => {
        el.style.display = el.dataset.themeIcon === theme ? '' : 'none';
    });
    document.querySelectorAll('[data-theme-label]').forEach(el => {
        el.textContent = theme === 'light' ? 'Dark mode' : 'Light mode';
    });
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
    syncThemeUI(theme);
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

function initThemeToggle() {
    const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    syncThemeUI(current);
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
        btn.addEventListener('click', () => {
            const now = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
            applyTheme(now === 'light' ? 'dark' : 'light');
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initHeroChart();
    initFaq();
    initTweaks();
    initThemeToggle();

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── Smooth scroll ─────────────────────────────────────────────
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) target.scrollIntoView({ behavior: 'smooth' });
        });
    });

    // ── Nav scroll state ──────────────────────────────────────────
    const nav = document.querySelector('nav');
    if (nav) {
        window.addEventListener('scroll', () => {
            nav.classList.toggle('scrolled', window.scrollY > 30);
        }, { passive: true });
    }

    // ── Mobile nav ────────────────────────────────────────────────
    const hamburger = document.getElementById('navHamburger');
    const mobileNav = document.getElementById('mobileNav');
    const mobileOverlay = document.getElementById('mobileNavOverlay');

    if (hamburger && mobileNav && mobileOverlay) {
        const toggleNav = (open) => {
            hamburger.classList.toggle('open', open);
            hamburger.setAttribute('aria-expanded', String(open));
            mobileNav.classList.toggle('open', open);
            mobileOverlay.classList.toggle('open', open);
            document.body.style.overflow = open ? 'hidden' : '';
        };

        hamburger.addEventListener('click', () => toggleNav(!mobileNav.classList.contains('open')));
        mobileOverlay.addEventListener('click', () => toggleNav(false));
        mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => toggleNav(false)));

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && mobileNav.classList.contains('open')) toggleNav(false);
        });
    }

    // ── Scroll reveal ─────────────────────────────────────────────
    // Auto-apply reveal + stagger to grid items
    const staggerGroups = [
        { selector: '.feature-card', step: 0.08 },
        { selector: '.step', step: 0.1 },
        { selector: '.price-card', step: 0.1 },
    ];

    staggerGroups.forEach(({ selector, step }) => {
        document.querySelectorAll(selector).forEach((el, i) => {
            el.classList.add('reveal');
            el.style.setProperty('--reveal-delay', `${i * step}s`);
        });
    });

    // Apply reveal to section headers and key elements
    [
        '.features-header',
        '.how-header',
        '.pricing-header',
        '.faq-header',
        '.ai-wrapper > div:first-child',
        '.ai-chat',
        '.platforms-bar .platforms-label',
    ].forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.classList.add('reveal'));
    });

    if (prefersReducedMotion) {
        document.querySelectorAll('.reveal').forEach(el => el.classList.add('in-view'));
    } else {
        const revealObserver = new IntersectionObserver((entries) => {
            entries.forEach(({ target, isIntersecting }) => {
                if (!isIntersecting) return;
                const delay = parseFloat(target.style.getPropertyValue('--reveal-delay') || 0);
                setTimeout(() => target.classList.add('in-view'), delay * 1000);
                revealObserver.unobserve(target);
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

        document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));
    }

    // ── Count-up for metric values ────────────────────────────────
    function countUp(el, target, duration, decimals) {
        const start = performance.now();
        const update = (now) => {
            const elapsed = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - elapsed, 3);
            const val = eased * target;
            el.textContent = decimals > 0 ? val.toFixed(decimals) : Math.round(val);
            if (elapsed < 1) requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
    }

    if (!prefersReducedMotion) {
        const countObserver = new IntersectionObserver((entries) => {
            entries.forEach(({ target, isIntersecting }) => {
                if (!isIntersecting) return;
                const targetVal = parseFloat(target.dataset.countTarget);
                const decimals = parseInt(target.dataset.countDecimals || 0);
                if (!isNaN(targetVal)) countUp(target, targetVal, 1200, decimals);
                countObserver.unobserve(target);
            });
        }, { threshold: 0.6 });

        document.querySelectorAll('[data-count-target]').forEach(el => countObserver.observe(el));
    }

    // ── Platform pills stagger reveal ─────────────────────────────
    if (!prefersReducedMotion) {
        document.querySelectorAll('.platform-pill').forEach((pill, i) => {
            pill.style.setProperty('--pill-delay', `${i * 0.07}s`);
            pill.classList.add('pill-reveal');
        });
    }
});
