(() => {
  const doc = document.documentElement;
  const style = doc.style;

  const updateViewportHeight = () => {
    if (window.CSS?.supports?.('height', '100dvh')) {
      return;
    }

    const vh = window.innerHeight * 0.01;
    style.setProperty('--vh', `${vh}px`);
    style.setProperty('--full-height', `${vh * 100}px`);
  };

  updateViewportHeight();

  let resizeTimer;

  window.addEventListener(
    'resize',
    () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(updateViewportHeight, 100);
    },
    { passive: true },
  );

  window.addEventListener(
    'orientationchange',
    () => {
      window.setTimeout(updateViewportHeight, 200);
    },
    { passive: true },
  );
})();
