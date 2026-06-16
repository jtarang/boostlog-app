export function initScramble() {
    const chars = '0123456789ABCDEF!@#$';
    const duration = 300; // ms
    const intervalTime = 30; // ms

    document.querySelectorAll('[data-scramble="true"]').forEach(el => {
        // Find the actual text element if the target contains nested elements (like an SVG)
        // We only want to scramble the text node part. 
        // A simple way is to wrap naked text nodes in span in HTML, or just scramble the textContent 
        // if there are no child elements. If it has child elements, scramble only the last child if it's text.
        // For our buttons, some have SVG + Text. We'll target the text by assuming it's the last child or only child.
        
        let targetTextEl = el;
        
        el.addEventListener('mouseenter', () => {
            if (el.dataset.scrambling === 'true') return;
            el.dataset.scrambling = 'true';

            // Find best text target to avoid scrambling SVG elements
            if (el.children.length > 0) {
                // If there's a span, target it, else target the button itself (which might destroy svg unfortunately)
                // Actually, best practice is to ensure text is in a span, OR we just scramble textContent safely.
                const span = el.querySelector('span');
                if (span) {
                    targetTextEl = span;
                }
            }

            const originalText = targetTextEl.textContent;
            const length = originalText.length;
            let elapsed = 0;

            const interval = setInterval(() => {
                elapsed += intervalTime;
                
                if (elapsed >= duration) {
                    clearInterval(interval);
                    targetTextEl.textContent = originalText;
                    el.dataset.scrambling = 'false';
                } else {
                    let scrambled = '';
                    for (let i = 0; i < length; i++) {
                        if (originalText[i] === ' ' || originalText[i] === '\n') {
                            scrambled += originalText[i];
                        } else {
                            scrambled += chars[Math.floor(Math.random() * chars.length)];
                        }
                    }
                    targetTextEl.textContent = scrambled;
                }
            }, intervalTime);
        });
    });
}
