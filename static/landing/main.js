import { initHeroChart } from './modules/hero.js';
import { initFaq } from './modules/faq.js';
import { initTweaks } from './modules/tweaks.js';

document.addEventListener('DOMContentLoaded', () => {
    initHeroChart();
    initFaq();
    initTweaks();


    // Mobile menu toggle if needed
    const setupMobileMenu = () => {
        // Implementation if there's a mobile burger
    };

    setupMobileMenu();
    
    // Smooth scroll for anchors
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth'
                });
            }
        });
    });
});
