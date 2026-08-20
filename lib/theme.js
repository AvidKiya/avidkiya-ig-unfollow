/**
 * Theme manager: 'dark' | 'light' | 'system'.
 * Applies data-theme on <html>; everything else is pure CSS variables.
 */

const media = window.matchMedia('(prefers-color-scheme: light)');

export function resolveTheme(setting) {
  if (setting === 'system') return media.matches ? 'light' : 'dark';
  return setting === 'light' ? 'light' : 'dark';
}

export function applyTheme(setting) {
  document.documentElement.dataset.themeSetting = setting;
  document.documentElement.dataset.theme = resolveTheme(setting);
}

/** Re-apply when the OS theme flips while set to "system". */
media.addEventListener?.('change', () => {
  if (document.documentElement.dataset.themeSetting === 'system') {
    applyTheme('system');
  }
});
