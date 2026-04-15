/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        viao: {
          bg: '#f7f8fa',
          bg2: '#eef2f7',
          panel: '#ffffff',
          panelSoft: '#f3f5f8',
          line: '#e4e8ee',
          text: '#0f172a',
          muted: '#475569',
          accent: '#0d9e7a',
          accent2: '#0a8566',
          accentLight: '#e6f7f2',
          accentRing: 'rgba(13, 158, 122, 0.25)',
          success: '#34d399',
          warn: '#f59e0b',
          danger: '#ef4444',
        },
      },
      boxShadow: {
        viao: '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.03)',
        viaoLg: '0 4px 12px rgba(0, 0, 0, 0.06)',
      },
      backdropBlur: {
        viao: '16px',
      },
    },
  },
  plugins: [],
};
