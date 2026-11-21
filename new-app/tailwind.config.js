/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/presentation/web/**/*.{html,js,ts,jsx,tsx}',
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-base': 'var(--surface-base, var(--bg))',
        'surface-card': 'var(--surface-card, var(--surface))',
        text: 'var(--text)',
        'text-muted': 'var(--text-muted)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        accent: 'var(--accent)',
        'on-accent': 'var(--on-accent)',
        danger: 'var(--danger)',
        'on-danger': 'var(--on-danger)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
      },
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
    },
  },
  plugins: [],
};
