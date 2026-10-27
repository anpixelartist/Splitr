// Light / dark theme. The preference is per device ('system' follows the OS);
// the resolved theme is written to <html data-theme>, which the CSS variables
// in index.css and Tailwind's `dark:` variant both key off. index.html runs the
// same resolution inline before first paint so dark users never see a flash.

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'splitr_theme';
const THEME_COLORS = { light: '#f2f2f7', dark: '#000000' }; // browser/status bar

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch { /* storage blocked */ }
  return 'system';
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const theme = pref === 'dark' || (pref === 'system' && systemDark()) ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref);
  } catch { /* storage blocked: still applies for this session */ }
  applyTheme(pref);
}

/** Re-applies the theme when the OS switches (e.g. at sunset) while on 'system'. */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => {};
  const onChange = () => { if (getThemePref() === 'system') applyTheme('system'); };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
