export function setupHomeMotion(home) {
  const opening = home.querySelector('.home-opening');
  const photo = opening.querySelector('.home-visual');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;

  function updatePhoto() {
    if (home.hidden || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (home.hidden || reduceMotion.matches) return;
      const bounds = photo.getBoundingClientRect();
      const fadeDistance = Math.max(1, bounds.height - window.innerHeight * .38);
      const progress = Math.min(1, Math.max(0, -bounds.top / fadeDistance));
      const fade = progress * progress;
      opening.style.setProperty('--home-photo-opacity', 1 - fade * fade * (3 - 2 * fade));
    });
  }

  window.addEventListener('scroll', updatePhoto, { passive: true });
  window.addEventListener('resize', updatePhoto);
  reduceMotion.addEventListener('change', updatePhoto);

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

  return updatePhoto;
}
