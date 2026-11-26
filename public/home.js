export function setupHomeMotion(home) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove('awaiting-view');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -9% 0px' });

    for (const story of home.querySelectorAll('.home-story')) {
      story.classList.add('awaiting-view');
      observer.observe(story);
    }
  }

  for (const link of document.querySelectorAll('#home-link, .app-brand, #home-top-link')) {
    link.addEventListener('click', (event) => {
      if (location.hash !== '#home' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (link.id === 'home-top-link') document.getElementById('home-link').focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'instant' : 'smooth' });
    });
  }
}
