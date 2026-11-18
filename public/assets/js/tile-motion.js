export function revealTiles(elements) {
  if (!('IntersectionObserver' in window)) return () => {};
  const tiles = [...elements];
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = null;

  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting && !entry.target.hidden);
    const stagger = Math.min(60, 300 / Math.max(1, visible.length - 1));
    for (const [order, { target }] of visible.entries()) {
      observer.unobserve(target);
      if (target.matches(':focus-within')) continue;
      target.style.setProperty('--tile-enter-delay', `${order * stagger}ms`);
      target.classList.add('tile-entering');
    }
  }, { threshold: .08 });

  for (const tile of tiles) {
    tile.addEventListener('animationend', event => {
      if (event.target === tile && event.animationName === 'tile-enter') tile.classList.remove('tile-entering');
    });
    tile.addEventListener('focusin', () => tile.classList.remove('tile-entering'));
  }

  function replay() {
    if (frame !== null) cancelAnimationFrame(frame);
    observer.disconnect();
    observer.takeRecords();
    tiles.forEach(tile => tile.classList.remove('tile-entering'));
    if (motion.matches) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      tiles.filter(tile => !tile.hidden).forEach(tile => observer.observe(tile));
    });
  }
  motion.addEventListener('change', replay);
  replay();
  return replay;
}
