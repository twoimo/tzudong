(() => {
  if (window.CSS?.supports?.('height', '100dvh')) {
    return;
  }

  const style = document.documentElement.style;
  let resizeTimer = 0;
  let resizeFrame = 0;

  const updateViewportHeight = () => {
    const vh = window.innerHeight * 0.01;
    style.setProperty('--vh', `${vh}px`);
    style.setProperty('--full-height', `${vh * 100}px`);
  };

  const scheduleViewportHeightUpdate = (delay = 0) => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(updateViewportHeight);
    }, delay);
  };

  updateViewportHeight();

  window.addEventListener('resize', () => scheduleViewportHeightUpdate(100), { passive: true });
  window.addEventListener('orientationchange', () => scheduleViewportHeightUpdate(200), { passive: true });
})();
