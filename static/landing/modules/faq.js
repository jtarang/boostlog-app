export function initFaq() {
    const faqContainer = document.getElementById('faqContainer');
    if (!faqContainer) return;

    faqContainer.addEventListener('click', (e) => {
        const q = e.target.closest('.faq-q');
        if (!q) return;

        const item = q.closest('.faq-item');
        const a = item.querySelector('.faq-a');
        const icon = q.querySelector('.faq-icon');

        const isOpen = a.classList.contains('open');

        // Close all others
        faqContainer.querySelectorAll('.faq-a').forEach(el => el.classList.remove('open'));
        faqContainer.querySelectorAll('.faq-icon').forEach(el => el.classList.remove('open'));

        if (!isOpen) {
            a.classList.add('open');
            icon.classList.add('open');
        }
    });
}
