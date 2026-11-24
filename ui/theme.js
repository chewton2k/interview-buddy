// Loaded before the page paints, so the chosen theme never flashes.
(() => {
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const saved = () => {
    try {
      return localStorage.getItem('theme') ?? 'system';
    } catch {
      return 'system';
    }
  };
  const apply = () => {
    const choice = saved();
    document.documentElement.dataset.theme = choice === 'system' ? (dark.matches ? 'dark' : 'light') : choice;
    dispatchEvent(new Event('themechange'));
  };
  window.theme = {
    get choice() {
      return saved();
    },
    set(choice) {
      try {
        localStorage.setItem('theme', choice);
      } catch {}
      apply();
    },
  };
  dark.addEventListener('change', apply);
  addEventListener('storage', apply);
  apply();
})();
