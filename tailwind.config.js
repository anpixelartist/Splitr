/** @type {import('tailwindcss').Config} */

// Colours that change between light and dark themes come from CSS variables
// (see src/index.css), so existing classes like `bg-gray-50` or `text-gray-500`
// adapt without a `dark:` twin on every element.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (color, shades) => Object.fromEntries(shades.map(s => [s, v(`${color}-${s}`)]));

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // `dark:` variants follow the resolved theme on <html data-theme="…">
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      // Apple devices get their own SF Pro (no download); everyone else gets
      // self-hosted Inter, the closest open match, before the generic fallbacks
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"Inter Variable"', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      // Phone and desktop get different type scales (see --text-* in src/index.css)
      fontSize: {
        xs: ['var(--text-xs)', { lineHeight: 'var(--leading-xs)' }],
        sm: ['var(--text-sm)', { lineHeight: 'var(--leading-sm)' }],
        base: ['var(--text-base)', { lineHeight: 'var(--leading-base)' }],
      },
      colors: {
        surface: v('surface'),
        gray: scale('gray', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        // Only the pale tints flip; saturated shades read well on both themes
        // Saturated blues are Apple's button blue (#0071E3, 4.6:1 with white text)
        blue: { ...scale('blue', [50, 100, 200]), 500: '#0077ED', 600: '#0071E3', 700: '#0066CC' },
        green: scale('green', [50, 100, 200]),
        red: scale('red', [50, 100, 200]),
        amber: scale('amber', [50, 100, 200]),
        indigo: scale('indigo', [100]),
        emerald: scale('emerald', [50, 200]),
      },
    },
  },
  plugins: [],
}
